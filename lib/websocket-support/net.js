'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
exports.configureTcpPolyfill = configureTcpPolyfill;
exports.Socket = Socket;
exports.connect = connect;

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _blobToBuffer = require('blob-to-buffer');

var _blobToBuffer2 = _interopRequireDefault(_blobToBuffer);

var _eventemitter2 = require('eventemitter2');

var tcpPolyfillOptions = {
  path: '/',
  secure: false,
  wsProtocols: undefined,
  simulatedLatencyMs: undefined
};

var notImpl = function notImpl(name) {
  return function () {
    throw new Error('Not implemented in TcpPolyfill: ' + name);
  };
};

function configureTcpPolyfill(options) {
  tcpPolyfillOptions.path = options.path;
  tcpPolyfillOptions.secure = options.secure;
  tcpPolyfillOptions.wsProtocols = options.wsProtocols;
  tcpPolyfillOptions.simulatedLatencyMs = options.simulatedLatencyMs;
}

function Socket(options) {
  var _this = this;

  if (!(this instanceof Socket)) {
    return new Socket(options);
  }

  var emitter = new _eventemitter2.EventEmitter2({});
  ['on', 'once', 'removeListener', 'emit', 'addListener', 'removeAllListeners', 'setMaxListeners', 'listeners'].forEach(function (method) {
    _this[method] = emitter[method].bind(emitter);
  });

  var ws = null;

  this.connect = function (port, host, connectListener) {
    _this._simulatedLatencyMs = tcpPolyfillOptions.simulatedLatencyMs;
    var protocol = tcpPolyfillOptions.secure ? 'wss' : 'ws';
    var path = tcpPolyfillOptions.path;
    var url = protocol + '://' + host + ':' + port + path;
    ws = new WebSocket(url, tcpPolyfillOptions.wsProtocols);
    if (connectListener) {
      emitter.on('connect', connectListener);
    }

    ws.onopen = function (event) {
      emitter.emit('connect');
    };

    ws.onclose = function (event) {
      emitter.emit('end');
      emitter.emit('close');
    };

    ws.onerror = function (event) {
      emitter.emit('error', event);
    };

    ws.onmessage = function (event) {
      var data = event.data;
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        (0, _blobToBuffer2['default'])(data, function (err, buffer) {
          if (err) {
            throw err;
          }
          emitter.emit('data', buffer);
        });
      } else {
        emitter.emit('data', data);
      }
    };
  };

  this.end = function (data) {
    if (data !== undefined) {
      _this.write(data);
    }
    ws.close();
  };

  this.destroy = function () {
    ws.close();
  };

  this.write = function (data) {
    // Convert data (string or node.js Buffer) to ArrayBuffer for WebSocket
    var arrayBuffer = new ArrayBuffer(data.length);
    var view = new Uint8Array(arrayBuffer);
    for (var i = 0; i < data.length; ++i) {
      view[i] = data[i];
    }
    var delay = _this._simulatedLatencyMs;
    if (typeof delay === 'number' && delay > 0) {
      setTimeout(function () {
        return ws.send(arrayBuffer);
      }, delay);
    } else {
      ws.send(arrayBuffer);
    }
  };

  this.setNoDelay = function (noDelay) {};
  this.setKeepAlive = function (enable, initialDelay) {};

  var notImplMethods = ['setEncoding', 'pause', 'resume', 'setTimeout', 'address', 'unref', 'ref'];
  notImplMethods.forEach(function (name) {
    _this[name] = notImpl(name);
  });
}

function connect() {
  var opts = {};
  if (arguments[0] && typeof arguments[0] === 'object') {
    opts.port = arguments[0].port;
    opts.host = arguments[0].host;
    opts.connectListener = arguments[1];
  } else if (Number(arguments[0]) > 0) {
    opts.port = arguments[0];
    opts.host = arguments[1];
    opts.connectListener = arguments[2];
  } else {
    throw new Error('Unsupported arguments for net.connect');
  }
  var socket = new Socket();
  socket.connect(opts.port, opts.host, opts.connectListener);
  return socket;
}

var createConnection = connect;

exports.createConnection = createConnection;
var createServer = notImpl('createServer');

exports.createServer = createServer;
// This is wrong, but irrelevant for connecting via websocket
var isIPv4 = function isIPv4(input) {
  return true;
};
exports.isIPv4 = isIPv4;
var isIPv6 = function isIPv6(input) {
  return false;
};
exports.isIPv6 = isIPv6;
var isIP = function isIP(input) {
  return isIPv4(input) ? 4 : isIPv6(input) ? 6 : 0;
};
exports.isIP = isIP;