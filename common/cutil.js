// Common utility functions used by both the server and the client.

var crypto = ((typeof module) === 'object') ? require('crypto') : undefined;

var cutil = { };

cutil.checker = {
    number : function(v) {
        return ((typeof v) === 'number') && (v === v); // exclude NaN
    },
    integer : function(v) {
        return ((typeof v) === 'number') && (v === Math.floor(v));
    },
    bool : function(v) {
        return ((typeof v) === 'boolean');
    },
    stringEnum : function(options) {
        var okay = { };
        options.forEach(function(o) {
            okay[o] = true;
        });
        return function(v) {
            return okay[v];
        };
    },
    stringMaxLen : function(maxLen) {
        return function(v) {
            return ((typeof v) === 'string') && (v.length <= maxLen);
        };
    },
    string : function(v) {
        return (cutil.checker.stringMaxLen(500))(v);
    },
    imageDataUrl : function(v) {
        return (((typeof v) === 'string') && (v.length < 100*1000) &&
                v.match(/^data:image\/(jpeg|png);base64,[0-9A-Za-z+\/]*=*$/));
    },
    uri : function(v) {
        return (((typeof v) === 'string') && (v.length < 300) &&
                v.match(/^(http|https):\/\//));
    },
    hex256b : function(v) {
        return ((typeof v) === 'string') &&
               (v.match(/^[0-9a-f]{64}$/));
    },
    hex128b : function(v) {
        return ((typeof v) === 'string') &&
               (v.match(/^[0-9a-f]{32}$/));
    },
    btcAddr : function(v) {
        return ((typeof v) === 'string') &&
               (v.match(/^[0-9a-zA-Z]{26,35}$/));
    },
    btcPubKey : function(v) {
        return ((typeof v) === 'string') &&
               (v.match(/^(02|03)([0-9a-f][0-9a-f]){10,100}$/));
    },
    btcSignature : function(v) {
        return ((typeof v) === 'string') &&
               (v.match(/^[0-9a-zA-Z+\/]{10,300}=*$/));
    },
    btcTx : function(v) {
        return ((typeof v) === 'string') &&
               (v.match(/^([0-9a-f]{2}){50,1000}$/));
    },
    btcSecretKey : function(v) {
        return ((typeof v) === 'string') &&
               (v.match(/^[0-9a-zA-Z]+$/));
    },
    cipherText : function(v) {
        return ((typeof v) === 'string') &&
               (v.length < 10*1000) &&
               (v.match(/^[A-Za-z0-9+\/]+=*$/));
    },
    array : function(f) {
        return function(v) {
            if((typeof v) !== 'object') return false;
            if(!(v instanceof Array)) return false;
            
            var okay = true;
            v.forEach(function(vv) {
                if(!f(vv)) okay = false;
            });
            return okay;
        };
    },
    optional : function(f) {
        return function(v) {
            if((typeof v) === 'undefined') return true;
            return f(v);
        };
    },

    check : function(objIn, fmt) {
        var objOut = { };
        for(var field in fmt) {
            if(!((fmt[field])(objIn[field]))) {
                throw 'bad property: ' + field;
            }
            objOut[field] = objIn[field];
        }
        return objOut;
    },
};

cutil.btcToSatoshis = function(btc) {
    return Math.round(btc * 100e6);
};

cutil.satoshisToBtc = function(satoshis) {
    return satoshis / 100e6;
};

cutil.valueIsColoredSatoshis = function(satoshis) {
    return ((satoshis % 2) == 0);
};

cutil.valueIsColoredBtc = function(btc) {
    return cutil.valueIsColoredSatoshis(cutil.btcToSatoshis(btc));
};

cutil.workFromHash = function(hash) {
    var work = 1, buf = new Buffer(hash, 'hex');
    if(buf.length !== 32) throw 'bad hash len';
    for(var i = 0; i < buf.length; i++) {
        if(buf[i] === 0) {
            work *= 256;
        } else {
            for(var j = 7; j >= 0; j--) {
                if(buf[i] & (1 << j)) {
                    return work;
                } else {
                    work *= 2;
                }
            }
        }
    }
    throw 'hash not plausible';
};

cutil.sha256 = function(v) {
    // Treat strings as utf8
    if((typeof v) === 'string') v = new Buffer(v);

    if((typeof bitcoin) === 'object') {
        // client
        return bitcoin.crypto.sha256(v);
    } else {
        // server
        var ss = crypto.createHash('sha256');
        ss.update(v);
        return ss.digest();
    }
};

cutil.sha256Twice = function(v) {
    return cutil.sha256(cutil.sha256(v));
};

cutil.reverseBuffer = function(bufIn) {
    var n = bufIn.length, bufOut = new Buffer(n);
    for(var i = 0; i < n; i++) {
        bufOut[(n-1)-i] = bufIn[i];
    }
    return bufOut;
};

cutil.merkleHash = function(a, b) {
    a = cutil.reverseBuffer(new Buffer(a, 'hex'));
    b = cutil.reverseBuffer(new Buffer(b, 'hex'));

    var ab = cutil.sha256Twice(Buffer.concat([a, b]));

    ab = (cutil.reverseBuffer(ab)).toString('hex');
    return ab;
};

/**
 * Get a string representation (as 'txid,i') of a TXO from a
 * bitcoin.Transaction input.
 */
cutil.txoStringKey = function(txi) {
    return cutil.reverseBuffer(txi.hash).toString('hex') + ',' + txi.index;
};


if((typeof module) === 'object') module.exports = cutil;

