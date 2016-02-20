
aq.page.listingNew = {

'needKeys' : true,

'init' : function() {
    var mc = aq.getStorage('marketControl').msg;
    mc.categories.forEach(function(cat) {
        var l = cat.replace(/;/g, ': ');
            opt = $('<option/>', { 'text' : l, 'value' : cat });
        opt.appendTo('#listingNew-category');
    });
    var ticker = aq.getStorage('ticker');
    ticker.currencies.forEach(function(code) {
        var opt = $('<option/>', { 'text' : code, 'value' : code });
        opt.appendTo('#listingNew-currency');
    });

    function addItemRow() {
        var tr = $('<tr/>'), td = [ ];
        for(var i = 0; i < 4; i++) {
            td[i] = $('<td/>');
            td[i].appendTo(tr);
        }
        var desc = $('<input/>');
        desc.css('width', '300px');
        desc.appendTo(td[0]);
        var price = $('<input/>');
        price.css('width', '70px');
        price.appendTo(td[1]);
        var group = $('<select/>');
        group.appendTo(td[2]);
        $('<option/>', { 'text' : 'main', 'value' : 'main' }).appendTo(group);
        $('<option/>',
            { 'text' : 'shipping', 'value' : 'shipping' }).appendTo(group);
        var del = $('<div/>', { 'class' : 'button-small',
                                'text'  : 'Delete Row' });
        del.appendTo(td[3]);
        del.on('click', function() {
            if($('#listingNew-items').children().length > 2) tr.remove();
        });

        $('#listingNew-items-add-row').before(tr);
    }
    $('#listingNew-items-add').on('click', function() {
        addItemRow();
    });
    addItemRow();

    var haveThumb = { };
    function gotThumb(r) {
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.thumbs))) return;

        r.result.thumbs.forEach(function(thumb) {
            if(haveThumb[thumb.hash]) return;

            var div = $('<div/>'), label = $('<label/>');
            $('<img/>', {
                'src' : 'data:' + aq.imageDataUrl(thumb.thumb)
            }).appendTo(label);
            var check = $('<input/>', { 'type' : 'checkbox', });
            check.appendTo(label);
            label.appendTo(div);
            div.appendTo('#listingNew-images');

            haveThumb[thumb.hash] = check;
        });

        if(Object.keys(haveThumb).length === 0) {
            $('#listingNew-images').text(
                '\u2003(no images have been uploaded yet)');
        }
        ui.hidePopup('log');
    }
    $('#listingNew-create').on('click', function() {
        aq.page.listingNew.create(haveThumb);
    });

    var keys = aq.getStorage('keys');
    aq.rpc.toServers('searchMsg', {
        'type'      : 'image',
        'sigFrom'   : [ keys.primary ],
        'resultsAs' : 'thumb',
    }, gotThumb, null);

    ui.showPopup('log');
},

'create' : function(imgs) {
    function countryList(id) {
        var csv = $(id)[0].value;
        csv = csv.toUpperCase().replace('[^A-Za-z,]', '');
        var out = { };
        csv.split(',').forEach(function(c) {
            if(c === 'ANY') {
                ui.countryAll(out);
            } else if(c === 'EU') {
                ui.countryEu(out);
            } else if(ui.countryValid(c)) {
                out[c] = true;
            } else {
                throw 'country code not valid, ' + c +
                        ', valid codes are ISO 3166-1 alpha-2';
            }
        });
        return Object.keys(out);
    }

    try {
        var m = {
            'type'      : 'listing',
            'subject'   : $('#listingNew-subject')[0].value,
            'body'      : $('#listingNew-body')[0].value,
            'images'    : [ ],
            'category'  : $('#listingNew-category')[0].value,
            'shipFrom'  : countryList('#listingNew-from'),
            'shipTo'    : countryList('#listingNew-to'),
            'currency'  : $('#listingNew-currency')[0].value,
            'itemPrice' : [ ],
            'itemDesc'  : [ ],
            'itemGroup' : [ ],
        };

        var hash;
        for(hash in imgs) {
            if(imgs[hash][0].checked) {
                m.images.push(hash);
            }
        }

        var rows = $('#listingNew-items').children();
        for(var i = 0; i < rows.length - 1; i++) {
            var row = rows[i],
                desc = row.children[0].children[0].value,
                price = row.children[1].children[0].value,
                group = row.children[2].children[0].value;

                if(desc.length < 1) throw 'description is blank';
                price = price*1;
                if(!(price >= 0)) throw 'price is not a number';

                m.itemPrice.push(price);
                m.itemDesc.push(desc);
                m.itemGroup.push(group);
        }

        aq.finishAndSendMsg(m, function(m) {
            try {
                var mp = JSON.parse(m[0]);
                ui.navTo('listing', { 'hash' : mp.hash });
            } catch(e) {
            }
        });
    } catch(e) {
        ui.showPopup('notify', 'Bad format: ' + e);
    }
},

};


aq.page.listings = {

'needKeys' : true,

'init' : function() {
    var haveListing = { };
    function gotListing(r) {
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.listings))) return;

        r.result.listings.forEach(function(lst) {
            if(haveListing[lst.hash]) return;

            var tr = $('<tr/>'), td = $('<td/>');
            var a = $('<a/>', {
                'text' : lst.subject,
                'href' : '?a=listing&hash=' + encodeURI(lst.hash),
            });
            a.appendTo(td);
            td.appendTo(tr);
            $('<td/>', { 'text' : timeAgo(lst.timeReal) }).appendTo(tr);
            var check = $('<input/>', {
                'type' : 'radio',
                'name' : 'listings-delete',
            });
            td = $('<td/>');
            check.appendTo(td);
            td.appendTo(tr);
            tr.appendTo('#listings-existing');

            haveListing[lst.hash] = check;
        });
        
        ui.hidePopup('log');
    }
    $('#listings-delete').on('click', function() {
        var hash;
        for(hash in haveListing) {
            if(haveListing[hash][0].checked) {
                var dm = {
                    'type'      : 'deleteMessage',
                    'toDelete'  : hash,
                    'comment'   : 'by poster from client',
                };
                aq.finishAndSendMsg(dm, function() { ui.navReload(); });
                return;
            }
        }
        ui.showPopup('notify', 'No listing to delete selected.');
    });

    var keys = aq.getStorage('keys');
    aq.rpc.toServers('searchMsg', {
        'type'      : 'listing',
        'sigFrom'   : [ keys.primary ],
        'resultsAs' : 'listing',
    }, gotListing, null);
    ui.showPopup('log');
},

};


aq.page.listing = {

'needKeys' : false,

'init' : function() {

    var qtys = [ ];
    var listing, kfi;
    var mc = aq.getStorage('marketControl').msg;

    function getQtys() {
        if(!listing) return;
        var out = [ ];
        for(var i = 0; i < listing.itemPrice.length; i++) {
            var input = qtys[i][0];
            if(input.type === 'radio') {
                out.push(input.checked ? 1 : 0);
            } else {
                out.push(input.value*1);
            }
        }
        return out;
    }
    function updateTotal() {
        if(!listing) return;

        var q = getQtys(), total = 0;
        for(var i = 0; i < q.length; i++) {
            total += q[i]*listing.itemPrice[i];
        }
        var str;
        if(total > 0) {
            str = 'for total cost ' + total + ' ' + listing.currency;
            if(listing.currency !== 'BTC') {
                str += ' = ';
                str += ui.formatBtc(aq.currencyToBtc(total, listing.currency));
            }
        } else {
            str = 'bad quantities';
        }
        $('#listing-total').text(str);
    }

    var wantImage = { };
    function gotImage(r) {
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;

        r.result.msgs.forEach(function(img) {
            if(!wantImage[img.hash]) return;
            if(!aq.verifyMsgSignatures(img)) return;
            delete wantImage[img.hash];

            var div = $('<div/>');
            $('<img/>', {
                'src' : 'data:' + aq.imageDataUrl(img.image)
            }).appendTo(div);
            div.appendTo('#listing-images');
        });
    }

    var haveListing = false;
    function gotListing(r) {
        if(haveListing) return;
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;
        if(r.result.msgs.length != 1) return;
        var m = r.result.msgs[0];
        if(m.hash !== searchParam('hash')) return;
        if(m.type !== 'listing') return;
        if(!aq.verifyMsgSignatures(m)) return;

        if(!isArray(r.result.chain)) return
        var maySell = false;
        r.result.chain.forEach(function(chm) {
            if(chm.type === 'approveNewIdentity' && chm.pkhId === m.sigFrom) {
                if(!aq.verifyMsgSignatures(chm)) return;
                if(!msg.signedWithAuthorizedAdminKey(chm, mc)) {
                    ui.log('*** LISTING CREATOR approveNewIdentity SIGNER BAD');
                    return;
                }

                if(chm.maySell) maySell = true;
            }
            if(chm.type === 'keysForIdentity' && chm.sigFrom === m.sigFrom) {
                if(!aq.verifyMsgSignatures(chm)) return;
                kfi = chm;
            }
        });
        if(!maySell) {
            ui.log('*** LISTING CREATOR maySell is false');
            return;
        }
        if(!kfi) return;

        haveListing = true;
        listing = m;

        $('#listing-subject').text(m.subject);
        $('#listing-from').text(ui.countryShow(m.shipFrom));
        $('#listing-to').text(ui.countryShow(m.shipTo));
        $('#listing-category').text(m.category.replace(/;/g, ': '));

        ui.commentTable(m).appendTo('#listing-body');

        var i, nMain = 0;
        for(i = 0; i < m.itemGroup.length; i++) {
            if(m.itemGroup[i] !== 'main') continue;

            var tr = $('<tr/>');
            $('<td/>', { 'text' : m.itemDesc[i] }).appendTo(tr);
            $('<td/>', {
                'text' : m.itemPrice[i] + ' ' + m.currency,
            }).appendTo(tr);
            var qty = $('<input/>', {
                'value' : (nMain === 0) ? '1' : '0',
            });
            qty.on('input', updateTotal);
            qty.css('width', '40px');
            qtys[i] = qty;
            var td = $('<td/>');
            qty.appendTo(td);
            td.appendTo(tr);

            tr.appendTo('#listing-items');
            nMain++;
        }

        var nShip = 0;
        for(i = 0; i < m.itemGroup.length; i++) {
            if(m.itemGroup[i] !== 'shipping') continue;
            if(nShip === 0) {
                var tr = $('<tr/>');
                $('<th/>', { 'text' : 'Shipping' }).appendTo(tr);
                $('<th/>', { 'text' : 'Price' }).appendTo(tr);
                $('<th/>', { 'text' : '' }).appendTo(tr);
                tr.appendTo('#listing-items');
            }

            var tr = $('<tr/>');
            $('<td/>', { 'text' : m.itemDesc[i] }).appendTo(tr);
            $('<td/>', {
                'text' : m.itemPrice[i] + ' ' + m.currency,
            }).appendTo(tr);

            var sel = $('<input/>', {
                'type'    : 'radio',
                'name'    : 'listing-shipping-method',
                'checked' : (nShip === 0),
                'id'      : 'listing-qty-' + i,
            });
            sel.on('change', updateTotal);
            var td = $('<td/>');
            sel.appendTo(td)
            qtys[i] = sel;
            td.appendTo(tr);

            tr.appendTo('#listing-items');
            nShip++;
        }

        if(m.images.length > 0) {
            aq.rpc.toServers('searchMsg', {
                'hashInclude' : m.images,
                'resultsAs'   : 'msg',
            }, gotImage, null);
            m.images.forEach(function(hash) {
                wantImage[hash] = true;
            });
        }

        aq.getMsgBySearch({
            'type'     : 'deleteMessage',
            'toDelete' : m.hash
        }, function(dm) {
            if(!(dm && aq.verifyMsgSignatures(dm) &&
                (dm.type === 'deleteMessage') &&
                (dm.toDelete === m.hash) &&
                (msg.signedWithAuthorizedAdminKey(dm, mc) ||
                 (dm.sigFrom === m.sigFrom))))
            {
                return;
            }
            $('#page-listing').addClass('deleted');
            $('#listing-deleted').css('display', 'block');
            $('#listing-order').off('click');
        });

        updateTotal();
        ui.hidePopup();
    }

    $('#listing-order').on('click', function() {
        if(listing && kfi) {
            aq.page.listing.order(listing, kfi, getQtys());
        }
    });

    aq.rpc.toServers('searchMsg', {
        'hashInclude'  : [ searchParam('hash') ],
        'resultsAs'    : 'msg',
        'chainOfTrust' : true,
        'deletedOk'    : true,
    }, gotListing, null);
    ui.showPopup('log');
},

'order' : function(listing, kfiSeller, qtys) {
    ui.showPopup('wait');

    var keys = aq.getStorage('keys');
    if(!keys) {
        ui.navTo('keys');
        return;
    }

    var mc = aq.getStorage('marketControl').msg;

    function makeMessages(kfiAdmin) {
        try {
            var keys = aq.getStorage('keys'),
                myPks = aq.page.keys.getPublicKeys(), orderHash,
                ticker = aq.getStorage('ticker');

            // strip any internal properties that we added
            ticker = msg.fromUntrusted(ticker, 'check');
            if(!ticker) throw 'bad ticker';
            ticker = JSON.stringify(ticker);
          
            // First, the placeOrder message.
            do {
                var poTe = {
                    'stealth'   : randomBytes(32).toString('hex'),
                };
                var po = {
                    'type'      : 'placeOrder',
                    'listing'   : listing.hash,
                    'subject'   : listing.subject,
                    'qty'       : qtys,

                    'ticker'    : ticker,

                    'pkBuyer'   : myPks.btc,
                    'pkSeller'  : kfiSeller.pkBtc,
                    'pkAdmin'   : mc.adminBtc[0],

                    'cipherTo'  : [
                        listing.sigFrom,    // seller, from listing
                        keys.primary,       // buyer, me
                        mc.adminContact[0], // admin
                    ],
                    'sigFrom'   : keys.primary,
                    'sig'       : msg.notYetSigned,
                };
                msg.fillCiphered(po, poTe, [
                    kfiSeller.pkCrypt,      // seller, from chainOfTrust
                    myPks.crypt,            // buyer, me
                    kfiAdmin.pkCrypt,       // admin, retrieved explicitly
                ]);
                msg.fillTime(po);
                po = msg.fromUntrusted(po, 'compute');

            } while(!ecMath.validOrderHash(po.hash, poTe.stealth));

            msg.fillSignatures(po);
            orderHash = po.hash;
            po = JSON.stringify(po);

            // Then the privateComment with address and shipping details.

            var body = $('#listing-compose')[0].value;
            if(body.length < 10) throw 'address missing or too short';

            var pcTe = {
                'subject'   : 'ORDER: ' + listing.subject,
                'body'      : body,
            };
            var pc = {
                'type'      : 'privateComment',
                'ref'       : orderHash,
                'state'     : 'new',
                'cipherTo'  : [ listing.sigFrom ],
                'sigFrom'   : keys.primary,
                'sig'       : msg.notYetSigned,
            };
            msg.fillCiphered(pc, pcTe, [ kfiSeller.pkCrypt ]);
            msg.fillTime(pc);
            pc = msg.fromUntrusted(pc, 'compute');
            msg.fillSignatures(pc);
            pc = JSON.stringify(pc);

            // We can't use finishAndSengMsg (a) because we need to send two
            // messages, and (b) because we need to finish placeOrder before
            // we can start privateComment, because it refers to the order by
            // hash.
            aq.sendMsgWithCaptcha([ po, pc ], function() {
                ui.navTo('order', { 'hash' : orderHash });
            });
        } catch(e) {
            ui.showPopup('notify', 'Failed: ' + e);
        }
    }

    // We already have our own keys, and we have the seller's keys, from
    // chainOfTrust. We still need to get the admin contact's encryption
    // keys, so do that now.
    var gotAdminKfi = false;
    function gotOne(r) {
        if(gotAdminKfi) return;

        if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;
        if(r.result.msgs.length !== 1) return;
        var kfi = r.result.msgs[0];
        if(kfi.sigFrom !== mc.adminContact[0]) return;
        if(!aq.verifyMsgSignatures(kfi)) return;
        if(kfi.type !== 'keysForIdentity') return;

        gotAdminKfi = true; 
        makeMessages(kfi);
    }
    aq.rpc.toServers('searchMsg', {
        'type'         : 'keysForIdentity',
        'sigFrom'      : [ mc.adminContact[0] ],
        'resultsAs'    : 'msg',
        'limitResults' : 1,
    }, gotOne, null);
},

};


aq.page.search = {

'needKeys' : false,

/**
 * Listing search, like a buyer would use. We make one RPC to get the
 * listings, and then another to get thumbnail images if applicable.
 */
'init' : function() {
    var haveListing = { }, wantThumb = { };

    function gotThumb(r) {
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.thumbs))) return;

        r.result.thumbs.forEach(function(thumb) {
            if(!(thumb.hash in wantThumb)) return;

            wantThumb[thumb.hash].forEach(function(a) {
                var img = $('<img/>', {
                    'src' : 'data:' + aq.imageDataUrl(thumb.thumb)
                });
                $('<br/>').prependTo(a);
                img.prependTo(a);
            });

            delete wantThumb[thumb.hash];
        });
    }

    function gotListing(r) {
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.listings))) return;

        var wantMoreThumbs = false;
        r.result.listings.forEach(function(lst) {
            // Can't trust lst.hash since we don't have the full messages.
            // This way lets a bad server feed fake results (that we'll
            // notice and discard if the user clicks on them), but stops
            // them from hiding good results from a good server.
            var h = cutil.sha256(JSON.stringify(lst)).toString('hex');
            if(haveListing[h]) return;
            haveListing[h] = true;

            var a = $('<a/>', {
                    'href'  : '?a=listing&hash=' + encodeURI(lst.hash),
                    'class' : 'result',
                }), div = $('<div/>', { 'class' : 'vcent' });

            div.text(lst.subject);
            div.appendTo(a);
            a.appendTo('#search-results');

            if(lst.images.length > 0) {
                var ih = lst.images[0];
                if(ih in wantThumb) {
                    wantThumb[ih].push(div);
                } else {
                    wantThumb[ih] = [ div ];
                }
                wantMoreThumbs = true;
            }
        });

        if(wantMoreThumbs) {
            aq.rpc.toServers('searchMsg', {
                'hashInclude' : Object.keys(wantThumb),
                'resultsAs'   : 'thumb',
            }, gotThumb, null);
        }
        if(Object.keys(haveListing).length === 0) {
            $('#search-results').text('no results');
        }
        ui.hidePopup('log');
    }

    var query = {
        'type'          : 'listing',
        'resultsAs'     : 'listing',
        'sortBy'        : 'trust',
        'limitResults'  : conf.listingsPerPage,
    };
    function maybeAdd(inSp, inQuery, noForm) {
        if(!inQuery) inQuery = inSp;
        var sp = searchParam(inSp);
        if(sp) query[inQuery] = sp;
        if(!noForm) $('#search-' + inSp)[0].value = sp || '';
    }
    maybeAdd('category', null, true);
    maybeAdd('shipFrom');
    maybeAdd('shipTo');
    maybeAdd('seller', 'sigFrom');

    var c = searchParam('category');
    if(c) c = c.replace(/;/g, ': ');
    $('#search-category').text(c || 'everything');

    if(query.sigFrom) query.sigFrom  = [ query.sigFrom ];

    aq.rpc.toServers('searchMsg', query, gotListing, null);
    ui.showPopup('log');
},

'search' : function() {
    var nav = { },
        cat = searchParam('category');
    if(cat) nav.category = cat;

    function maybeAdd(inSp, uc) {
        var f = $('#search-' + inSp)[0].value;
        if(f) nav[inSp] = uc ? f.toUpperCase() : f;
    }
    maybeAdd('shipFrom', true);
    maybeAdd('shipTo', true);
    maybeAdd('seller', false);

    ui.navTo('search', nav);
},

};

