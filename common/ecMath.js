
var ecMath = { };
ecMath.curve = ecurve.getCurveByName('secp256k1');

/**
 * Make a stealth public key. adder is a bigi, and we add G*adder to
 * basePubKey, return is hex.
*/
ecMath.stealthPublicKeyInt = function(basePubKey, adder) {
    var adderEcp = new bitcoin.ECPair(adder, null, { 'network' : conf.btcNet });

    basePubKey = new Buffer(basePubKey, 'hex');
    var basePt  = ecurve.Point.decodeFrom(ecMath.curve, basePubKey),
        adderPt = adderEcp.Q,
        sumPt   = basePt.add(adderPt);

    var sumEcp = new bitcoin.ECPair(null, sumPt, { 'network' : conf.btcNet });

    return sumEcp.getPublicKeyBuffer().toString('hex');
};

/**
 * Make a stealth secret key. adder is a bigi, and we add adder to base,
 * return is WIF.
*/
ecMath.stealthSecretKeyInt = function(base, adder) {
    var baseEcp  = bitcoin.ECPair.fromWIF(base, conf.btcNet),
        adderEcp = new bitcoin.ECPair(adder, null, { 'network' : conf.btcNet });

    var sum = baseEcp.d.add(adderEcp.d);
    if(sum.compareTo(ecMath.curve.n) >= 0) {
        sum = sum.subtract(ecMath.curve.n);
    }

    var sumEcp = new bitcoin.ECPair(sum, null, { 'network' : conf.btcNet });
    return sumEcp.toWIF();
};

/**
 * Get a 2/3 multisig P2SH address from three public keys.
 */
ecMath.multisigAddress = function(pks) {
    var script = bitcoin.script.multisigOutput(2, pks),
        sho = bitcoin.script.scriptHashOutput(bitcoin.crypto.hash160(script)),
        addr = bitcoin.address.fromOutputScript(sho, conf.btcNet).toString();
    return addr;
};

/**
 * Given an order message, compute the stealth public keys, by computing
 * the stealth adder and then adding it to each base public key from the
 * order message.
 */
ecMath.getStealthPublicKeys = function(order, te) {
    var pks = [ ];
    var adderi = ecMath.adderFromMessage(order.hash, te.stealth);

    [ 'Buyer', 'Seller', 'Admin' ].forEach(function(role) {
        var pk = ecMath.stealthPublicKeyInt(order['pk' + role], adderi);
        pks.push(new Buffer(pk, 'hex'));
    });
    return pks;
};

/**
 * Given an order message and a base secret key, compute the stealth
 * secret key. Also works for paidFee, same structure.
 */
ecMath.getStealthSecretKey = function(m, te, skBase) {
    var adderi = ecMath.adderFromMessage(m.hash, te.stealth);

    return ecMath.stealthSecretKeyInt(skBase, adderi);
};

/**
 * Given an order message, compute the multisig payment address. So we
 * get the stealth public keys, and then get the address from that.
 */
ecMath.getMultisigAddress = function(order, te) {
    return ecMath.multisigAddress(ecMath.getStealthPublicKeys(order, te));
};

/**
 * Given a paidFee message, compute stealth P2PKH payment address.
 */
ecMath.getFeeAddress = function(pf, te) {
    var adderi = ecMath.adderFromMessage(pf.hash, te.stealth),
        pk = ecMath.stealthPublicKeyInt(pf.pkBtc, adderi);
   
    pk = new Buffer(pk, 'hex');
    var ecp = bitcoin.ECPair.fromPublicKeyBuffer(pk, conf.btcNet);
    return ecp.getAddress();
};

/**
 * Get the stealth adder for a given order hash and stealth nonce. The
 * buyer can't choose a stealth nonce that would give the same adder
 * (and thus same address) for two orders without finding a collision
 * in sha256.
 */
ecMath.adderFromMessage = function(orderHash, stealth) {
    var a = new Buffer(orderHash, 'hex'),
        b = new Buffer(stealth, 'hex'),
        ab = Buffer.concat([ a, b ]);

    if(a.length !== 32 || b.length !== 32 || ab.length !== 64) throw 'bad len';

    return bigi.fromBuffer(bitcoin.crypto.sha256(ab));
};

/**
 * Check if an order hash and stealth nonce yield a stealth adder in
 * valid range.
 */
ecMath.validOrderHash = function(orderHash, stealth) {
    var ei = ecMath.adderFromMessage(orderHash, stealth);

    // same test as in ecpair.js in bitcoinjs-lib
    return (ei.signum() > 0) && (ei.compareTo(ecMath.curve.n) < 0);
};

// The AES library works with arrays of 32-bit integers, so we need
// functions to transform the input/output buffer to/from that.
AES.bufferTo32 = function(buf, i) {
    return (buf[i+0] <<  0) |
           (buf[i+1] <<  8) |
           (buf[i+2] << 16) |
           (buf[i+3] << 24);
};
AES.bufferToArray32 = function(buf, i, n) {
    var out = [ ];
    for(var j = 0; j < n; j++) {
        out.push(AES.bufferTo32(buf, i + (j*4)));
    }
    return out;
};
AES.array32Xor = function(a, b) {
    if(a.length != b.length) throw 'lengths should match';
    var out = [ ];
    for(var i = 0; i < a.length; i++) {
        out.push(a[i] ^ b[i]);
    }
    return out;
};
AES.array32ToBuffer = function(array, buf, i) {
    array.forEach(function(v) {
        buf[i++] = (v >>  0) & 0xff;
        buf[i++] = (v >>  8) & 0xff;
        buf[i++] = (v >> 16) & 0xff;
        buf[i++] = (v >> 24) & 0xff;
    });
};

ecMath.encrypt = function(plainText, destPubKeys) {
    // Generate a random IV, and a random AES session key
    var iv = randomBytes(16), aesKey = randomBytes(32);

    // Generate a random ephemeral EC key pair
    var ephemEcp    = bitcoin.ECPair.makeRandom({ 'network' : conf.btcNet }),
        cipherEphem = ephemEcp.getPublicKeyBuffer().toString('hex');

    // Encrypt the message with our session key. First, set up the AES
    // library with our key.
    var aes = new AES(AES.bufferToArray32(aesKey, 0, 8));

    // Pad the message to a multiple of 16 bytes. It's JSON, so we can just
    // append spaces, with no need to strip the padding later. This works
    // with utf8 only because a space is represented as a single byte.
    while((Buffer.byteLength(plainText) % 16) !== 0) {
        plainText += ' ';
    }
    var plainTextBuf = new Buffer(plainText);

    // Append a MAC to our plaintext. The MAC is 16*2 bytes, so length is
    // still correctly padded. This MAC is probably unnecessary, since
    // no one but the sender can tamper with the message without rendering
    // the signature on the outer message (sigFrom and sig, not computed
    // here) invalid, but it stops the sender from sending a message that
    // validly decrypts to different outputs for different recipients.
    plainTextBuf = Buffer.concat([
        plainTextBuf,
        bitcoin.crypto.sha256(plainTextBuf),
    ]);

    // Then encrypt, using CBC mode.
    var cipherTextBuf = new Buffer(plainTextBuf.length), pt, ct;
    ct = AES.bufferToArray32(iv, 0, 4);
    for(var i = 0; i < plainTextBuf.length; i += 16) {
        pt = AES.array32Xor(ct, AES.bufferToArray32(plainTextBuf, i, 4));
        ct = aes.encrypt(pt);
        AES.array32ToBuffer(ct, cipherTextBuf, i);
    }

    // Then, for each recipient's public key, encrypt the session key.
    var cipherSessionKey = [ ], cipherPkhCrypt = [ ];
    destPubKeys.forEach(function(destPubKey) {
        var dpkbuf = new Buffer(destPubKey, 'hex'),
            destEcp = bitcoin.ECPair.fromPublicKeyBuffer(dpkbuf, conf.btcNet);

        // The recipient is already identified with cipherTo (which isn't
        // considered here), but a single recipient may have multiple keys
        // used for encryption due to key rotation. By including this hash,
        // we tell him which we used.
        cipherPkhCrypt.push(destEcp.getAddress());

        // Do ECDH to compute a shared secret
        var ecdh   = (destEcp.Q).multiply(ephemEcp.d),
            secret = bitcoin.crypto.sha256(ecdh.affineX.toBuffer());

        // And we send that secret xor the session key
        var xor = new Buffer(32);
        for(var i = 0; i < 32; i++) {
            xor[i] = secret[i] ^ aesKey[i];
        }
        cipherSessionKey.push(xor.toString('hex'));
    });

    return { 'cipherEphem'      : cipherEphem,
             'cipherIv'         : iv.toString('hex'),
             'cipherPkhCrypt'   : cipherPkhCrypt,
             'cipherSessionKey' : cipherSessionKey,
             'cipherText'       : cipherTextBuf.toString('base64'), };
};

ecMath.decrypt = function(msg, privKey) {
    // First, compute the hash that identifies which of the (generally
    // multiple) recipients we are.
    var privEcp = bitcoin.ECPair.fromWIF(privKey, conf.btcNet);
    var privAddr = privEcp.getAddress();

    for(var i = 0; i < msg.cipherPkhCrypt.length; i++) {
        if(msg.cipherPkhCrypt[i] === privAddr) {
            break;
        }
    }
    if(i >= msg.cipherPkhCrypt.length) {
        // This message doesn't seem to be for us.
        return;
    }

    // Decode the EC point corresponding to the ephemeral public key
    var ephemPubKey = new Buffer(msg.cipherEphem, 'hex'),
        ephemPt = ecurve.Point.decodeFrom(ecMath.curve, ephemPubKey);
    // and use that to do ECDH, and compute our shared secret.
    var ecdh = ephemPt.multiply(privEcp.d),
        secret = bitcoin.crypto.sha256(ecdh.affineX.toBuffer());

    // That secret xor the quantity sent to us gives us our AES key
    var session = new Buffer(msg.cipherSessionKey[i], 'hex'),
        aesKey  = new Buffer(32);
    for(var j = 0; j < 32; j++) {
        aesKey[j] = secret[j] ^ session[j];
    }

    // So we set up the AES library with that key
    var aes = new AES(AES.bufferToArray32(aesKey, 0, 8));

    // And now we're ready to decrypt. Base64-decode the ciphertext, and
    // confirm that it's an integer number of cipher blocks.
    var cipherTextBuf = new Buffer(msg.cipherText, 'base64');
    if((cipherTextBuf.length % 16) !== 0) {
        return;
    }
    // Allocate a buffer of equal length for the decrypted plaintext.
    var plainTextBuf = new Buffer(cipherTextBuf.length);

    // And decrypt, CBC mode.
    var iv = AES.bufferToArray32(new Buffer(msg.cipherIv, 'hex'), 0, 4),
        pt, ct;
    for(var j = 0; j < cipherTextBuf.length; j += 16) {
        ct = AES.bufferToArray32(cipherTextBuf, j, 4);
        pt = AES.array32Xor(aes.decrypt(ct), iv);
        AES.array32ToBuffer(pt, plainTextBuf, j);
        iv = ct;
    }

    // Check the inner MAC, as described above
    var mac1 = plainTextBuf.slice(-32),
        plainTextBuf = plainTextBuf.slice(0, -32),
        mac2 = bitcoin.crypto.sha256(plainTextBuf);
    for(var j = 0; j < 32; j++) {
        if(mac1[j] !== mac2[j]) return;
    }

    return {
        'text'   : plainTextBuf.toString(),
        'aesKey' : aesKey.toString('hex'),
    };
};

/**
 * Verify an ECDSA signature. This is copied from bitcoinjs-lib since
 * they don't export it.
 */
ecMath.verifyEcdsa = function(hash, signature, Q) {
    var secp256k1 = ecMath.curve;

    var n = secp256k1.n;
    var G = secp256k1.G;

    var r = signature.r;
    var s = signature.s;

    if (r.signum() <= 0 || r.compareTo(n) >= 0) return false;
    if (s.signum() <= 0 || s.compareTo(n) >= 0) return false;

    var e = bigi.fromBuffer(hash);
    var sInv = s.modInverse(n);
    var u1 = e.multiply(sInv).mod(n);
    var u2 = r.multiply(sInv).mod(n);
    var R = G.multiplyTwo(u1, Q, u2);
    if (secp256k1.isInfinity(R)) return false;
    var xR = R.affineX;
    var v = xR.mod(n);
    return v.equals(r);
};

ecMath.test = function() {
    // test stealth Bitcoin address generation

    // generate three random key pairs
    var order = { }, ecp = { }, te = { };
    [ 'pkBuyer', 'pkSeller', 'pkAdmin' ].forEach(function(p) {
        ecp[p] = bitcoin.ECPair.makeRandom({ 'network' : conf.btcNet });
        order[p] = ecp[p].getPublicKeyBuffer().toString('hex');
    });
    // and a stealth adder
    do {
        order.hash = randomBytes(32).toString('hex');
        te.stealth = randomBytes(32).toString('hex');
    } while(!ecMath.validOrderHash(order.hash, te.stealth));
    // get stealth public keys
    var pks = ecMath.getStealthPublicKeys(order, te);
    // and then also get each stealth secret key, convert each secret key
    // to a public key, and confirm that we get the same answer
    [ 'pkBuyer', 'pkSeller', 'pkAdmin' ].forEach(function(p) {
        var pk = pks.shift().toString('hex');
        
        var sk = ecMath.getStealthSecretKey(order, te, ecp[p].toWIF());
        var ecp2 = bitcoin.ECPair.fromWIF(sk, conf.btcNet),
            pk2 = ecp2.getPublicKeyBuffer().toString('hex');
        console.log('from pk: ' + pk);
        console.log('from sk: ' + pk2);
        if(pk !== pk2)
            console.log('    *** FAIL, NOT MATCHING');
        else
            console.log('    ok, match');
    });

    // test encryption
    var recipient = bitcoin.ECPair.makeRandom({ 'network' : conf.btcNet }),
        recipientPubKey = recipient.getPublicKeyBuffer().toString('hex');

    var ct = ecMath.encrypt('{ hello, world, padding }', [ recipientPubKey ]);
    console.log('sender encrypts to ' + JSON.stringify(ct, null, '  '));
    var pt = ecMath.decrypt(ct, recipient.toWIF());
    console.log('recipient decrypts to ' + JSON.stringify(pt, null, '  '));
};
//ecMath.test();

