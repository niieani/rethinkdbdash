var helper = require('./helper');
var Promise = require('bluebird');
var Err = require('./error');
var events_1 = require('events');
var Cursor = (function () {
    function Cursor(connection, token, options, type) {
        this.connection = connection;
        this.token = token;
        this._index = 0; // Position in this._data[0]
        this._data = []; // Array of non empty arrays
        this._fetching = false; // Are we fetching data
        this._canFetch = true; // Can we fetch more data?
        this._pendingPromises = []; // Pending promises' resolve/reject
        this.options = options || {};
        this._closed = false;
        this._type = type;
        this._setIncludesStates = false;
        if ((type === 'feed') || (type === 'atomFeed')) {
            this.toArray = function () {
                throw new Error('The `toArray` method is not available on feeds.');
            };
        }
        this.each = this._each;
        this.eachAsync = this._eachAsync;
        this.next = this._next;
    }
    Cursor.prototype._eachCb = function (err, data) {
        // We should silent things if the cursor/feed is closed
        if (this._closed === false) {
            if (err) {
                this._eventEmitter.emit('error', err);
            }
            else {
                this._eventEmitter.emit('data', data);
            }
        }
    };
    Cursor.prototype._makeEmitter = function () {
        var _this = this;
        this.next = function () {
            throw new Err.ReqlDriverError('You cannot call `next` once you have bound listeners on the ' + _this._type);
        };
        this.each = function () {
            throw new Err.ReqlDriverError('You cannot call `each` once you have bound listeners on the ' + _this._type);
        };
        this.eachAsync = function () {
            throw new Err.ReqlDriverError('You cannot call `eachAsync` once you have bound listeners on the ' + _this._type);
        };
        this.toArray = function () {
            throw new Err.ReqlDriverError('You cannot call `toArray` once you have bound listeners on the ' + _this._type);
        };
        this._eventEmitter = new events_1.EventEmitter();
    };
    Cursor.prototype.close = function (callback) {
        var _this = this;
        var self = this;
        this._closed = true;
        var p = new Promise(function (resolve, reject) {
            if ((_this._canFetch === false) && (_this._fetching === false)) {
                resolve();
            }
            else {
                _this.connection._end(_this.token, resolve, reject);
            }
        }).nodeify(callback);
        return p;
    };
    Cursor.prototype._set = function (ar) {
        this._fetching = false;
        this._canFetch = false;
        if (ar.length > 0) {
            this._data.push(ar);
        }
        this._flush();
    };
    Cursor.prototype._done = function () {
        this._canFetch = false;
    };
    Cursor.prototype._pushError = function (error) {
        this._data.push([error]);
        this._flush();
    };
    Cursor.prototype._flush = function () {
        while ((this._pendingPromises.length > 0) && ((this._data.length > 0) || ((this._fetching === false) && (this._canFetch === false)))) {
            var fullfiller = this._pendingPromises.shift();
            var resolve = fullfiller.resolve;
            var reject = fullfiller.reject;
            if (this._data.length > 0) {
                var result = this._data[0][this._index++];
                if (result instanceof Error) {
                    reject(result);
                }
                else {
                    resolve(result);
                }
                if (this._data[0].length === this._index) {
                    this._index = 0;
                    this._data.shift();
                    if ((this._data.length <= 1)
                        && (this._canFetch === true)
                        && (this._closed === false)
                        && (this._fetching === false)) {
                        this._fetch();
                    }
                }
            }
            else {
                reject(new Err.ReqlDriverError('No more rows in the ' + this._type.toLowerCase()).setOperational());
            }
        }
    };
    Cursor.prototype._push = function (data) {
        var couldfetch = this._canFetch;
        if (data.done)
            this._done();
        var response = data.response;
        this._fetching = false;
        // If the cursor was closed, we ignore all following response
        if ((response.r.length > 0) && (couldfetch === true)) {
            this._data.push(helper.makeSequence(response, this.options));
        }
        // this._fetching = false
        if ((this._closed === false) && (this._canFetch) && (this._data.length <= 1))
            this._fetch();
        this._flush();
    };
    Cursor.prototype._fetch = function () {
        var _this = this;
        this._fetching = true;
        var p = new Promise(function (resolve, reject) {
            _this.connection._continue(_this.token, resolve, reject);
        }).then(function (response) {
            _this._push(response);
        }).error(function (error) {
            _this._fetching = false;
            _this._canFetch = false;
            _this._pushError(error);
        });
    };
    Cursor.prototype.hasNext = function () {
        throw new Error('The `hasNext` command has been removed in 1.13, please use `next`.');
    };
    Cursor.prototype.toJSON = function () {
        if (this._type === 'Cursor') {
            throw new Err.ReqlDriverError('You cannot serialize a Cursor to JSON. Retrieve data from the cursor with `toArray` or `next`');
        }
        else {
            throw new Err.ReqlDriverError('You cannot serialize a ' + this._type + ' to JSON. Retrieve data from the cursor with `each` or `next`');
        }
    };
    Cursor.prototype.getType = function () {
        return this._type;
    };
    Cursor.prototype.includesStates = function () {
        return this._setIncludesStates;
    };
    Cursor.prototype.setIncludesStates = function () {
        this._setIncludesStates = true;
    };
    Cursor.prototype.toString = function () {
        return '[object ' + this._type + ']';
    };
    Cursor.prototype._eachAsync = function (callback, onFinish) {
        var _this = this;
        if (this._closed === true) {
            return callback(new Err.ReqlDriverError('You cannot retrieve data from a cursor that is closed').setOperational());
        }
        var self = this;
        var reject = function (err) {
            if (err.message === 'No more rows in the ' + _this._type.toLowerCase() + '.') {
                if (typeof onFinish === 'function') {
                    onFinish();
                }
            }
            else {
                callback(err);
            }
        };
        var resolve = function (data) { return callback(data).then(function () {
            if (_this._closed === false) {
                return _this._next().then(resolve).error(function (error) {
                    if ((error.message !== 'You cannot retrieve data from a cursor that is closed.') &&
                        (error.message.match(/You cannot call `next` on a closed/) === null)) {
                        reject(error);
                    }
                });
            }
            return null;
        }); };
        return this._next().then(resolve).error(function (error) {
            // We can silence error when the cursor is closed as this 
            if ((error.message !== 'You cannot retrieve data from a cursor that is closed.') &&
                (error.message.match(/You cannot call `next` on a closed/) === null)) {
                reject(error);
            }
        });
    };
    Cursor.prototype._each = function (callback, onFinish) {
        var _this = this;
        if (this._closed === true) {
            return callback(new Err.ReqlDriverError('You cannot retrieve data from a cursor that is closed').setOperational());
        }
        var self = this;
        var reject = function (err) {
            if (err.message === 'No more rows in the ' + _this._type.toLowerCase() + '.') {
                if (typeof onFinish === 'function') {
                    onFinish();
                }
            }
            else {
                callback(err);
            }
        };
        var resolve = function (data) {
            var keepGoing = callback(null, data);
            if (keepGoing === false) {
                if (typeof onFinish === 'function') {
                    onFinish();
                }
            }
            else {
                if (_this._closed === false) {
                    _this._next().then(resolve).error(function (error) {
                        if ((error.message !== 'You cannot retrieve data from a cursor that is closed.') &&
                            (error.message.match(/You cannot call `next` on a closed/) === null)) {
                            reject(error);
                        }
                    });
                }
            }
            return null;
        };
        this._next().then(resolve).error(function (error) {
            // We can silence error when the cursor is closed as this 
            if ((error.message !== 'You cannot retrieve data from a cursor that is closed.') &&
                (error.message.match(/You cannot call `next` on a closed/) === null)) {
                reject(error);
            }
        });
    };
    Cursor.prototype.toArray = function (callback) {
        var _this = this;
        var p = new Promise(function (resolve, reject) {
            var result = [];
            var i = 0;
            _this._each(function (err, data) {
                if (err) {
                    reject(err);
                }
                else {
                    result.push(data);
                }
            }, function () {
                resolve(result);
            });
        }).nodeify(callback);
        return p;
    };
    Cursor.prototype._next = function (callback) {
        var self = this;
        var p = new Promise(function (resolve, reject) {
            if (self._closed === true) {
                reject(new Err.ReqlDriverError('You cannot call `next` on a closed ' + this._type));
            }
            else if ((self._data.length === 0) && (self._canFetch === false)) {
                reject(new Err.ReqlDriverError('No more rows in the ' + self._type.toLowerCase()).setOperational());
            }
            else {
                if ((self._data.length > 0) && (self._data[0].length > self._index)) {
                    var result = self._data[0][self._index++];
                    if (result instanceof Error) {
                        reject(result);
                    }
                    else {
                        resolve(result);
                        // This could be possible if we get back batch with just one document?
                        if (self._data[0].length === self._index) {
                            self._index = 0;
                            self._data.shift();
                            if ((self._data.length === 1)
                                && (self._canFetch === true)
                                && (self._closed === false)
                                && (self._fetching === false)) {
                                self._fetch();
                            }
                        }
                    }
                }
                else {
                    self._pendingPromises.push({ resolve: resolve, reject: reject });
                }
            }
        }).nodeify(callback);
        return p;
    };
    return Cursor;
})();
exports.Cursor = Cursor;
var methods = [
    'addListener',
    'on',
    'once',
    'removeListener',
    'removeAllListeners',
    'setMaxListeners',
    'listeners',
    'emit'
];
for (var i = 0; i < methods.length; i++) {
    (function (n) {
        var method = methods[n];
        Cursor.prototype[method] = function () {
            var self = this;
            if (self._eventEmitter == null) {
                self._makeEmitter();
                setImmediate(function () {
                    if ((self._type === 'feed') || (self._type === 'atomFeed')) {
                        self._each(self._eachCb.bind(self));
                    }
                    else {
                        self._each(self._eachCb.bind(self), function () {
                            self._eventEmitter.emit('end');
                        });
                    }
                });
            }
            var _len = arguments.length;
            var _args = new Array(_len);
            for (var _i = 0; _i < _len; _i++) {
                _args[_i] = arguments[_i];
            }
            self._eventEmitter[method].apply(self._eventEmitter, _args);
        };
    })(i);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3Vyc29yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2N1cnNvci50cyJdLCJuYW1lcyI6WyJDdXJzb3IiLCJDdXJzb3IuY29uc3RydWN0b3IiLCJDdXJzb3IuX2VhY2hDYiIsIkN1cnNvci5fbWFrZUVtaXR0ZXIiLCJDdXJzb3IuY2xvc2UiLCJDdXJzb3IuX3NldCIsIkN1cnNvci5fZG9uZSIsIkN1cnNvci5fcHVzaEVycm9yIiwiQ3Vyc29yLl9mbHVzaCIsIkN1cnNvci5fcHVzaCIsIkN1cnNvci5fZmV0Y2giLCJDdXJzb3IuaGFzTmV4dCIsIkN1cnNvci50b0pTT04iLCJDdXJzb3IuZ2V0VHlwZSIsIkN1cnNvci5pbmNsdWRlc1N0YXRlcyIsIkN1cnNvci5zZXRJbmNsdWRlc1N0YXRlcyIsIkN1cnNvci50b1N0cmluZyIsIkN1cnNvci5fZWFjaEFzeW5jIiwiQ3Vyc29yLl9lYWNoIiwiQ3Vyc29yLnRvQXJyYXkiLCJDdXJzb3IuX25leHQiXSwibWFwcGluZ3MiOiJBQUFBLElBQVksTUFBTSxXQUFNLFVBQVUsQ0FBQyxDQUFBO0FBQ25DLElBQU8sT0FBTyxXQUFXLFVBQVUsQ0FBQyxDQUFDO0FBQ3JDLElBQVksR0FBRyxXQUFNLFNBQVMsQ0FBQyxDQUFBO0FBQy9CLHVCQUEyQixRQUFRLENBQUMsQ0FBQTtBQUVwQztJQXdLRUEsZ0JBQVlBLFVBQVVBLEVBQUVBLEtBQUtBLEVBQUVBLE9BQU9BLEVBQUVBLElBQUlBO1FBQzFDQyxJQUFJQSxDQUFDQSxVQUFVQSxHQUFHQSxVQUFVQSxDQUFDQTtRQUM3QkEsSUFBSUEsQ0FBQ0EsS0FBS0EsR0FBR0EsS0FBS0EsQ0FBQ0E7UUFFbkJBLElBQUlBLENBQUNBLE1BQU1BLEdBQUdBLENBQUNBLENBQUNBLENBQUNBLDRCQUE0QkE7UUFDN0NBLElBQUlBLENBQUNBLEtBQUtBLEdBQUdBLEVBQUVBLENBQUNBLENBQUNBLDRCQUE0QkE7UUFDN0NBLElBQUlBLENBQUNBLFNBQVNBLEdBQUdBLEtBQUtB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R0EsSUFBSUEsQ0FBQ0EsU0FBU0EsQ0FBQ0E7UUFDaENBLEVBQUVBLENBQUNBLENBQUNBLElBQUlBLENBQUNBLElBQUlBLENBQUNBO1lBQUNBLElBQUlBLENBQUNBLEtBQUtBLEVBQUVBLENBQUNBO1FBQzVCQSxJQUFJQSxRQUFRQSxHQUFHQSxJQUFJQSxDQUFDQSxRQUFRQSxDQUFDQTtRQUM3QkEsSUFBSUEsQ0FBQ0EsU0FBU0EsR0FBR0EsS0FBS0EsQ0FBQ0E7UUFDdkJBLDZEQUE2REE7UUFDN0RBLEVBQUVBLENBQUNBLENBQUNBLENBQUNBLFFBQVFBLENBQUNBLENBQUNBLENBQUNBLE1BQU1BLEdBQUdBLENBQUNBLENBQUNBLElBQUlBLENBQUNBLFVBQVVBLEtBQUtBLElBQUlBLENBQUNBLENBQUNBLENBQUNBLENBQUNBO1lBQ3JEQSxJQUFJQSxDQUFDQSxLQUFLQSxDQUFDQSxJQUFJQSxDQUFDQSxNQUFNQSxDQUFDQSxZQUFZQSxDQUFDQSxRQUFRQSxFQUFFQSxJQUFJQSxDQUFDQSxPQUFPQSxDQUFDQSxDQUFDQSxDQUFDQTtRQUMvREEsQ0FBQ0E7UUFDREEseUJBQXlCQTtRQUN6QkEsRUFBRUEsQ0FBQ0EsQ0FBQ0EsQ0FBQ0EsSUFBSUEsQ0FBQ0EsT0FBT0EsS0FBS0EsS0FBS0EsQ0FBQ0EsSUFBSUEsQ0FBQ0EsSUFBSUEsQ0FBQ0EsU0FBU0EsQ0FBQ0EsSUFBSUEsQ0FBQ0EsSUFBSUEsQ0FBQ0EsS0FBS0EsQ0FBQ0EsTUFBTUEsSUFBSUEsQ0FBQ0EsQ0FBQ0EsQ0FBQ0E7WUFBQ0EsSUFBSUEsQ0FBQ0EsTUFBTUEsRUFBRUEsQ0FBQ0E7UUFDNUZBLElBQUlBLENBQUNBLE1BQU1BLEVBQUVBLENBQUNBO0lBQ2hCQSxDQUFDQTtJQUVEVCx1QkFBTUEsR0FBTkE7UUFBQVUsaUJBWUNBO1FBWENBLElBQUlBLENBQUNBLFNBQVNBLEdBQUdBLElBQUlBLENBQUNBO1FBRXRCQSxJQUFJQSxDQUFDQSxHQUFHQSxJQUFJQSxPQUFPQSxDQUFDQSxVQUFDQSxPQUFPQSxFQUFFQSxNQUFNQTtZQUNsQ0EsS0FB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