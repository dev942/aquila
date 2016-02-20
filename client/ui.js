
ui = {
    init : function() {
        var a, p, page;

        $('#logosub').text(conf.network);
        
        if(!((a = searchParam('a')) &&
             (p = a.match(/^[-a-zA-Z0-9_]+$/)) &&
             (page = $('#page-' + p[0])) &&
             (page.length === 1)))
        {
            ui.navTo('index');
            return;
        }

        page.css('display', 'block');
        $('#page-default').css('display', 'none');

        $('input.btcaddr').each(function(t, obj) {
            $(obj)[0].placeholder = '1xxx59kuE';
        });
        $('input.hash').each(function(t, obj) {
            var h = '0123456789abcdef';
            $(obj)[0].placeholder = h + h + h + h;
        });

        $('#log-text')[0].value = '';
        this.attachClickHandlers();

        aq.init();
    },
    log : function(text) {
        var lt = $('#log-text')[0];
        lt.value = lt.value + text + '\n';
        lt.scrollTop = lt.scrollHeight;
    },
    attachClickHandlers : function() {
        $('div').each(function(i, obj) {
            var o = $(obj);
            if(o.data('click')) {
                o.off('click');
                o.on('click', ui.clickHandler);
            }
            if(o.data('address')) {
                o.off('click');
                o.on('click', ui.addressBookHandler);
            }
        });
        $('span.tab').each(function(t, obj) {
            var o = $(obj);
            if(o.data('tab')) {
                o.off('click');
                o.on('click', ui.tabHandler);
            }
        });
    },
    clickHandler : function(e) {
        var dest = $(e.target).data('click');
        var f, a = searchParam('a');
        if((a in aq.page) && (dest in aq.page[a])) {
            (aq.page[a][dest])();
        } else if(dest in aq) {
            (aq[dest])();
        }
    },
    tabHandler : function(e) {
        $('div.tab-content').each(function(i, obj) {
            $(obj).css('display', 'none');
        });
        $('span.tab').each(function(i, obj) {
            $(obj).removeClass('tab-sel');
            $(obj).addClass('tab-unsel');
        });
        $(e.target).removeClass('tab-unsel');
        $(e.target).addClass('tab-sel');
        $('#' + $(e.target).data('tab')).css('display', 'block');
    },
    addressBookHandler : function(e) {
        var dest = $(e.target).data('address');
        var mc = aq.getStorage('marketControl').msg,
            ac = mc.adminContact[0];

        var ab = aq.getStorage('addressBook');
        if(!ab) ab = { };
        delete ab[ac];
        var pkhs = Object.keys(ab);

        pkhs.sort(function(a, b) {
            if(a === b) return 0;
            return (a > b) ? 1 : -1;
        });
        pkhs = [ ac ].concat(pkhs);
        ab[ac] = 'adminContact';

        var tb = $('#addressBook-popup-body');
        tb.html('');
        pkhs.forEach(function(pkh) {
            var tr =  $('<tr/>', { 'class' : 'hoverhl' }),
                tda = $('<td/>', { 'text' : pkh, 'class' : 'mono' }),
                tdn = $('<td/>', { 'text' : ab[pkh] });

            if(pkh === ac) tdn.addClass('admin');
            tda.appendTo(tr);
            tdn.appendTo(tr);

            tr.appendTo(tb);
            tr.on('click', function() {
                $('#' + dest)[0].value = pkh;
                ui.hidePopup();
            });
        });
        ui.showPopup('addressBook');
    },
    showPopup : function(popup, p) {
        this.hidePopup();
        $('#popup-' + popup).css('display', 'block');
        this.popupShown = popup;
        $('#dimmer').css('display', 'block');
        window.scrollTo(0, 0);

        switch(popup) {
            case 'notify':
                $('#popup-notify-text').text(p);
                break;
        }
    },
    hidePopup : function() {
        if(this.popupShown) {
            $('#popup-' + this.popupShown).css('display', 'none');
            this.popupShown = undefined;
            $('#dimmer').css('display', 'none');
        }
    },

    navTo : function(a, extra) {
        var p, str = '?a=' + encodeURI(a);
        for(p in extra) {
            str += '&' + encodeURI(p) + '=' + encodeURI(extra[p]);
        }
        window.location = str;
    },
    navReload : function() {
        window.location.reload();
    },
    pageWithSkip : function(skip, paramsToCopy) {
        var obj = { 'skip' : Math.max(0, skip) };
        paramsToCopy.forEach(function(p) {
            var spp = searchParam(p);
            if(spp) obj[p] = spp;
        });
        ui.navTo(searchParam('a'), obj);
    },
    pageControls : function(dest, copy, things, skipped, nPage, nTotal, mpp) {
        var dcnt = $(dest + '-count');
        if(nPage > 0 && nTotal > 0) {
            dcnt.text(things + (skipped + 1) + '-' + (skipped + nPage) +
                                                            ' of ' + nTotal);
        } else if(nTotal > 0) {
            dcnt.text('skipped too far?');
        } else {
            dcnt.text('no ' + things);
        }
        var dnew = $(dest + '-newer'),
            dold = $(dest + '-older');
        dnew.css('display', (skipped > 0) ? 'inline' : 'none');
        dold.css('display', ((skipped+nPage) < nTotal) ? 'inline' : 'none');

        dnew.off('click');
        dold.off('click');

        dnew.on('click', function() { ui.pageWithSkip(skipped - mpp, copy); });
        dold.on('click', function() { ui.pageWithSkip(skipped + mpp, copy); });
    },

    hashLink : function(h, page) {
        if(!h.match(/^[0-9a-f]{64}$/)) throw 'not hash';

        var a = $('<a/>', {
            'text'  : h,
            'class' : 'wrap mono',
            'href'  : '?a=' + (page || 'msg') + '&hash=' + encodeURI(h),
        });
        return a;
    },
    hashTableCell : function(h, page) {
        var a = ui.hashLink(h, page), td = $('<td/>', { 'class' : 'wrap' });
        a.appendTo(td);
        return td;
    },

    btcLink : function(btc) {
        return $('<a/>', {
            'text'   : btc,
            'href'   : conf.btcExplorer + encodeURI(btc),
            'target' : '_blank',
            'class'  : 'payaddr'
        });
    },
    formatBtc : function(btc) {
        // non-breaking space
        return ui.formatBtcBare(btc) + '\u00A0' + 'BTC';
    },
    formatBtcBare : function(btc) {
        return isNum(btc) ? btc.toFixed(6) : '???';
    },

    wrapTd : function(e) {
        var td = $('<td/>');
        e.appendTo(td);
        return td;
    },
    addressDiv : function(pkh, oneLine) {
        var raw = $('<a/>', {
            'text' : pkh,
            'href' : '?a=user&pkh=' + encodeURI(pkh),
            'class' : 'mono'
        });
        raw.css('display', 'block');
        raw.css('line-height', '130%');
        raw.css('margin-bottom', '2px');
        raw.css('color', 'inherit');
        raw.addClass('wrap');
        if(!oneLine) raw.css('width', '130px');

        // Show adminSuper and adminContact keys specially formatted, to
        // make it easy to identify real admins vs. scammers.
        var mc = aq.getStorage('marketControl').msg, adminType = undefined;
        for(var i = 0; i < mc.adminContact.length; i++) {
            if(mc.adminContact[i] === pkh) {
                adminType = 'adminContact';
                break;
            }
        }
        for(var i = 0; i < mc.adminPkh.length; i++) {
            if(mc.adminPkh[i] === pkh && mc.adminType[i] === 'adminSuper') {
                adminType = 'adminSuper';
                break;
            }
        }

        var ab = aq.getStorage('addressBook');
        if(!ab) ab = { };
        var a = $('<a/>', { 'href' : '?a=addressBook&pkh=' + encodeURI(pkh) });
        if(pkh in ab) {
            a.text(ab[pkh]);
        } else if(adminType) {
            a.text(adminType);
        } else {
            var keys = aq.getStorage('keys');
            if(keys && (pkh in keys.secretKeys)) {
                a.text('me');
                a.addClass('me');
            } else {
                a.text('new user');
                a.css('font-style', 'italic');
            }
        }
        a.css('font-size', '14px');
        a.css('display', 'block');
        if(adminType) {
            a.addClass('admin');
        }

        var out = $('<div/>');
        out.css('display', 'inline-block');
        if(oneLine) {
            raw.css('display', 'inline');
            a.css('display', 'inline');
            raw.appendTo(out);
            $('<span/>', { 'text' : ', ' }).appendTo(out);
            a.appendTo(out);
        } else {
            raw.appendTo(out);
            a.appendTo(out);
        }
        return out;
    },

    commentTable : function(m, params) {
        if(!params) params = { };

        var table = $('<table/>', { 'class' : 'borders comment' });

        var tr0 = $('<tr/>'), tr1 = $('<tr/>'), fa, s, b;

        fa = $('<td/>', { 'rowspan' : 2 });

        var ft   = params.showToNotFrom ? 'TO:' : 'FROM:',
            addr = params.showToNotFrom ? m.cipherTo[0] : m.sigFrom;
        $('<div/>', { 'text' : ft, 'class' : 'fromto'  }).appendTo(fa);
        ui.addressDiv(addr).appendTo(fa);

        var da = $('<div/>', { 'text' : timeAgo(m.timeReal) + ' ago' });
        da.css('margin', '7px 0 10px 0');
        da.css('font-size', '14px');
        da.appendTo(fa);

        if(params.replyButton) {
            var b = $('<div/>', {
                    'class' : 'button-small likereply',
                    'text'  : 'Reply',
                });
            b.appendTo(fa);
            $('<br/>').appendTo(fa);

            var keys = aq.getStorage('keys'), sendReplyTo, replySubject;
            if(m.sigFrom === keys.primary) {
                // reply to a message that you sent goes to same recipient
                // as before
                sendReplyTo = m.cipherTo[0];
            } else {
                sendReplyTo = m.sigFrom;
            }
            replySubject = m.subject;
            if(!replySubject.match(/^Re: /))
                replySubject = 'Re: ' + replySubject;
            b.on('click', function() {
                ui.navTo('compose', { 'to'      : sendReplyTo,
                                      'subject' : replySubject });
            });
        }
        var alreadyRead = aq.isAlreadyRead(m);
        if(params.markReadButton) {
            var b = $('<div/>', {
                'class' : 'button-small likereply',
                'text'  : alreadyRead ? 'Mark Unread' : 'Mark Read',
            });
            b.appendTo(fa);
            b.on('click', function() {
                aq.markAlreadyRead(m, !alreadyRead);
                ui.navReload();
            });
        }

        s = $('<td/>');
        if(m.ref && m.type === 'privateComment' && !params.noOrderLink) {
            var subject = m.subject.replace(/^ORDER:/, '');
            s.text(subject);
            $('<a/>', {
                'text' : 'ORDER:',
                'href' : '?a=order&hash=' + encodeURI(m.ref),
            }).prependTo(s);
        } else {
            s.text(m.subject);
        }
        b = $('<td/>');
        if(m.body) b.text(m.body + '\n\n');
        if(m.ref && m.state && m.type === 'privateComment') {
            var st = $('<div/>', { 'text' : m.state, 'class' : 'state' });
            $('<b/>', { 'text' : 'STATE CHANGED TO: ' }).prependTo(st);
            st.appendTo(b);
        }
        if(m.tx && m.ref) {
            var str;
            try {
                var info = aq.getTransactionInfo(m.tx);

                if(info.n == 1) str = 'proposed, 1/3 ';
                if(info.n == 2) str = 'accepted, 2/3 ';

                var txd = $('<div/>', { 'text' : str, 'class' : 'state' });
                $('<b/>', { 'text' : 'ESCROW RELEASE: ' }).prependTo(txd);
                if(info.n === 1) {
                    var but = $('<div/>', {
                        'text'  : 'View Proposal',
                        'class' : 'button-small',
                    });
                    but.on('click', function() {
                        ui.navTo('release', {
                            'order' : m.ref,
                            'tx'    : m.tx,
                            'to'    : m.sigFrom
                        });
                    });
                    but.appendTo(txd);
                } else {
                    var but = $('<div/>', {
                        'text'  : 'View Transaction',
                        'class' : 'button-small',
                    });
                    but.on('click', function() {
                        $('#viewTx-tx')[0].value = m.tx;
                        $('#viewTx-n').text(2);
                        ui.showPopup('viewTx');
                    });
                    but.appendTo(txd);
                }
                txd.appendTo(b);
            } catch(e) {
                str = 'bad tx';
            }
        }

        fa.css('width', '120px');
        s.css('height', '15px');
        table.css('width', params.narrower ? '640px' : '690px');
        table.css('margin', '15px 0 10px 0');
        table.css('margin-left', params.isReply ? '20px' : '0');
        s.css('font-weight', 'bold');

        if(alreadyRead) table.addClass('msg-read');
        [ fa, s ].forEach(function(e) {
            if(alreadyRead) {
                e.addClass('bg-read');
            } else if(params.isReply) {
                e.addClass('bg-reply');
            } else {
                e.addClass('bg-top');
            }
        });
        [ fa, s, b ].forEach(function(e) {
            e.css('vertical-align', 'top');
        });
        b.css('white-space', 'pre-wrap');
        s.css('padding-top', '3px');
        s.css('padding-bottom', '3px');

        fa.appendTo(tr0);
        s.appendTo(tr0);
        b.appendTo(tr1);
        tr0.appendTo(table);
        tr1.appendTo(table);

        return table;
    },

    countryList : [
        'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT',
        'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI',
        'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY',
        'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
        'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM',
        'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK',
        'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL',
        'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
        'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR',
        'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN',
        'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS',
        'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
        'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW',
        'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP',
        'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM',
        'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
        'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM',
        'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF',
        'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW',
        'IS', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG',
        'VI', 'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
    ],
    countryEuList : [
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
        'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
        'SI', 'ES', 'SE', 'GB',
    ],
    countryAll : function(out) {
        ui.countryList.forEach(function(c) { out[c] = true; });
    },
    countryEu : function(out) {
        ui.countryEuList.forEach(function(c) { out[c] = true; });
    },
    countryValid : function(c) {
        var valid = false;
        ui.countryList.forEach(function(ct) { if(c === ct) valid = true; });
        return valid;
    },
    countryShow : function(l) {
        var h = { }, prefix = [ ];
        l.forEach(function(c) { h[c] = true; });
        function collapse(l2, to)  {
            var haveAll = true;
            l2.forEach(function(c) { if(!h[c]) haveAll = false; });
            if(haveAll) {
                l2.forEach(function(c) { delete h[c]; });
                prefix.push(to);
            }
        }
        collapse(ui.countryList, 'ANY');
        collapse(ui.countryEuList, 'EU');
        return prefix.concat(Object.keys(h)).join(', ');
    },

};

window.addEventListener('load', function() { ui.init(); });

