var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var stream_1 = require('stream');
// Experimental, but should work fine.
var TransformStream = (function (_super) {
    __extends(TransformStream, _super);
    function TransformStream(table, options, connection) {
        _super.call(this);
        this._table = table;
        this._r = table._r;
        this._options = options;
        this._cache = [];
        this._pendingCallback = null;
        this._ended = false;
        this._inserting = false;
        this._delayed = false;
        this._connection = connection;
        this._highWaterMark = options.highWaterMark || 100;
        this._insertOptions = {};
        this._insertOptions.durability = options.durability || 'hard';
        this._insertOptions.conflict = options.conflict || 'error';
        this._insertOptions.returnChanges = options.returnChanges || true;
        // Internal option to run some tests
        if (options.debug === true) {
            this._sequence = [];
        }
        stream_1.Transform.call(this, {
            objectMode: true,
            highWaterMark: this._highWaterMark
        });
    }
    TransformStream.prototype._flush = function (done) {
        this._ended = true;
        if ((this._cache.length === 0) && (this._inserting === false)) {
            done();
        }
        else {
            if (this._inserting === false) {
                this._flushCallback = done;
                this._insert();
            }
            else {
                this._flushCallback = done;
            }
        }
    };
    TransformStream.prototype._insert = function () {
        var _this = this;
        var self = this;
        this._inserting = true;
        var cache = this._cache;
        this._cache = [];
        if (Array.isArray(this._sequence)) {
            this._sequence.push(cache.length);
        }
        var pendingCallback = this._pendingCallback;
        this._pendingCallback = null;
        if (typeof pendingCallback === 'function') {
            pendingCallback();
        }
        var query = this._table.insert(cache, this._insertOptions);
        if (this._options.format === 'primaryKey') {
            query = query.do(function (result) { return _this._r.branch(result('errors').eq(0), _this._table.config()('primary_key').do(function (primaryKey) { return result('changes')('new_val')(primaryKey); }), result(_this._r.error(result('errors').coerceTo('STRING').add(' errors returned. First error:\n').add(result('first_error'))))); });
        }
        query.run(this._connection).then(function (result) {
            _this._inserting = false;
            if (_this._options.format === 'primaryKey') {
                for (var i = 0; i < result.length; i++) {
                    _this.push(result[i]);
                }
            }
            else {
                if (result.errors > 0) {
                    _this._inserting = false;
                    _this.emit('error', new Error('Failed to insert some documents:' + JSON.stringify(result, null, 2)));
                }
                else {
                    if (_this._insertOptions.returnChanges === true) {
                        for (var i = 0; i < result.changes.length; i++) {
                            _this.push(result.changes[i].new_val);
                        }
                    }
                }
            }
            pendingCallback = _this._pendingCallback;
            _this._pendingCallback = null;
            if (typeof pendingCallback === 'function') {
                // Mean that we can buffer more
                pendingCallback();
            }
            else if (_this._ended !== true) {
                if (((((_this._writableState.lastBufferedRequest === null) ||
                    _this._writableState.lastBufferedRequest.chunk === _this._cache[_this._cache.length - 1])))
                    && (_this._cache.length > 0)) {
                    _this._insert();
                }
            }
            else if (_this._ended === true) {
                if (_this._cache.length > 0) {
                    _this._insert();
                }
                else {
                    if (typeof _this._flushCallback === 'function') {
                        _this._flushCallback();
                    }
                    _this.push(null);
                }
            }
        }).error(function (error) {
            _this._inserting = false;
            _this.emit('error', error);
        });
    };
    TransformStream.prototype._next = function (value, encoding, done) {
        var _this = this;
        if ((this._writableState.lastBufferedRequest != null) && (this._writableState.lastBufferedRequest.chunk !== value)) {
            // There's more data to buffer
            if (this._cache.length < this._highWaterMark) {
                this._delayed = false;
                // Call done now, and more data will be put in the cache
                done();
            }
            else {
                if (this._inserting === false) {
                    if (this._delayed === true) {
                        // We have to flush
                        this._delayed = false;
                        this._insert();
                        // Fill the buffer while we are inserting data
                        done();
                    }
                    else {
                        var self = this;
                        this._delayed = true;
                        setImmediate(function () {
                            _this._next(value, encoding, done);
                        });
                    }
                }
                else {
                    // to call when we are dong inserting to keep buffering
                    this._pendingCallback = done;
                }
            }
        }
        else {
            if (this._inserting === false) {
                if (this._delayed === true) {
                    this._delayed = false;
                    // to call when we are dong inserting to maybe flag the end
                    this._insert();
                    // We can call done now, because we have _flush to close the stream
                    done();
                }
                else {
                    var self = this;
                    this._delayed = true;
                    setImmediate(function () {
                        _this._next(value, encoding, done);
                    });
                }
            }
            else {
                this._delayed = false;
                // There is nothing left in the internal buffer
                // But something is already inserting stuff.
                if (this._cache.length < this._highWaterMark - 1) {
                    // Call done, to attempt to buffer more
                    // This may trigger _flush
                    //this._pendingCallback = done;
                    done();
                }
                else {
                    this._pendingCallback = done;
                }
            }
        }
    };
    TransformStream.prototype._transform = function (value, encoding, done) {
        this._cache.push(value);
        this._next(value, encoding, done);
    };
    return TransformStream;
})(stream_1.Transform);
exports.TransformStream = TransformStream;
;
// Everytime we want to insert but do not have a full buffer,
// we recurse with setImmediate to give a chance to the input
// stream to push a few more elements
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhbnNmb3JtX3N0cmVhbS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy90cmFuc2Zvcm1fc3RyZWFtLnRzIl0sIm5hbWVzIjpbIlRyYW5zZm9ybVN0cmVhbSIsIlRyYW5zZm9ybVN0cmVhbS5jb25zdHJ1Y3RvciIsIlRyYW5zZm9ybVN0cmVhbS5fZmx1c2giLCJUcmFuc2Zvcm1TdHJlYW0uX2luc2VydCIsIlRyYW5zZm9ybVN0cmVhbS5fbmV4dCIsIlRyYW5zZm9ybVN0cmVhbS5fdHJhbnNmb3JtIl0sIm1hcHBpbmdzIjoiOzs7OztBQUFBLHVCQUF3QixRQUFRLENBQUMsQ0FBQTtBQUlqQyxzQ0FBc0M7QUFDdEM7SUFBcUNBLG1DQUFTQTtJQWdCNUNBLHlCQUFZQSxLQUFLQSxFQUFFQSxPQUFPQSxFQUFFQSxVQUFVQTtRQUNwQ0MsaUJBQU9BLENBQUNBO1FBQ1JBLElBQUlBLENBQUNBLE1BQU1BLEdBQUdBLEtBQUtBLENBQUNBO1FBQ3BCQSxJQUFJQSxDQUFDQSxFQUFFQSxHQUFHQSxLQUFLQSxDQUFDQSxFQUFFQSxDQUFDQTtRQUNuQkEsSUFBSUEsQ0FBQ0EsUUFBUUEsR0FBR0EsT0FBT0EsQ0FBQ0E7UUFDeEJBLElBQUlBLENBQUNBLE1BQU1BLEdBQUdBLEVBQUVBLENBQUNBO1FBQ2pCQSxJQUFJQSxDQUFDQSxnQkFBZ0JBLEdBQUdBLElBQUlBLENBQUNBO1FBQzdCQSxJQUFJQSxDQUFDQSxNQUFNQSxHQUFHQSxLQUFLQSxDQUFDQTtRQUNwQkEsSUFBSUEsQ0FBQ0EsVUFBVUEsR0FBR0EsS0FBS0EsQ0FBQ0E7UUFDeEJBLElBQUlBLENBQUNBLFFBQVFBLEdBQUdBLEtBQUtBLENBQUNBO1FBQ3RCQSxJQUFJQSxDQUFDQSxXQUFXQSxHQUFHQSxVQUFVQSxDQUFDQTtRQUM5QkEsSUFBSUEsQ0FBQ0EsY0FBY0EsR0FBR0EsT0FBT0EsQ0FBQ0EsYUFBYUEsSUFBSUEsR0FBR0EsQ0FBQ0E7UUFDbkRBLElBQUlBLENBQUNBLGNBQWNBLEdBQUdB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