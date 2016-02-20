
aq.page.userInfo = {

'needKeys' : true,

'init' : function() {
    var keys = aq.getStorage('keys'), latest = 0;
    aq.getMsgsBySearch({
        'type'         : 'publicComment',
        'ref'          : 'userInfo',
        'sigFrom'      : [ keys.primary ],
        'limitResults' : 1,
    }, function(r) {
        if(r.length === 0) {
            ui.hidePopup('log');
            return;
        }
        if(r.length !== 1) return;
        var m = r[0];
        if(!((m.type === 'publicComment') &&
             (m.sigFrom === keys.primary) &&
             (m.ref === 'userInfo') &&
             aq.verifyMsgSignatures(m)))
        {
            return;
        }
        if(m.timeReal > latest) {
            $('#userInfo-body')[0].value = m.body;
            $('#userInfo-subject')[0].value = m.subject;
            latest = m.timeReal;
        }
        ui.hidePopup('log');
    });
},

'post' : function() {
    var pc = {
        'type'      : 'publicComment',
        'subject'   : $('#userInfo-subject')[0].value,
        'body'      : $('#userInfo-body')[0].value,
        'ref'       : 'userInfo',
    };
    aq.finishAndSendMsg(pc, function() { ui.navReload(); });
},

'user' : function() {
    var keys = aq.getStorage('keys');
    ui.navTo('user', { 'pkh' : keys.primary });
},

};


aq.page.user = {

'needKeys' : false,

'init' : function() {
    var mc = aq.getStorage('marketControl').msg,
        owners = aq.getStorage('owners');

    var pkh = searchParam('pkh');
    $('#user-pkh')[0].value = pkh;

    ui.showPopup('log');
    aq.getMsgBySearch({
        'type'          : 'publicComment',
        'ref'           : 'userInfo',
        'sigFrom'       : [ pkh ],
    }, function(m) {
        if(!(m && aq.verifyMsgSignatures(m) &&
            (m.type === 'publicComment') &&
            (m.ref === 'userInfo') &&
            (m.sigFrom === pkh)))
        {
            return;
        }
        $('#user-info').text('');
        ui.commentTable(m).appendTo('#user-info');
    });

    aq.getMsgBySearch({
        'sigFrom'       : [ pkh ],
    }, function(m) {
        if(!(m && aq.verifyMsgSignatures(m) && (m.sigFrom === pkh))) return;

        $('#user-ago').text(timeAgo(m.timeReal) + ' ago');
    });

    aq.getMsgBySearch({
        'pkhId'               : pkh,
        'approveNewIdentity'  : 1,
    }, function(m) {
        if(!(m && aq.verifyMsgSignatures(m) &&
            (m.type === 'approveNewIdentity') &&
            (m.pkhId === pkh) &&
            msg.signedWithAuthorizedAdminKey(m, mc)))
        {
            return;
        }
        if(m.pkhId in owners) {
            $('#user-owner').css('display', 'block');
        } else {
            if(m.allowed) {
                if(m.maySell) {
                    $('#user-seller').css('display', 'block');
                } else {
                    if(mc.adminContact.some(function(a) {
                        return (a === pkh);
                    }) || mc.adminPkh.some(function(a) {
                        return (a === pkh);
                    })) {
                        $('#user-admin').css('display', 'block');
                    } else {
                        $('#user-buyer').css('display', 'block');
                    }
                }
            } else {
                $('#user-banned').css('display', 'block');
            }
        }
        $('#user-valid').text('from ' + timePlusMinus(m.validFrom) +
                              ' to '  + timePlusMinus(m.validTo));
        ui.hidePopup();
    });
},

'search' : function() {
    ui.navTo('user', { 'pkh' : $('#user-pkh')[0].value });
},

'listings' : function() {
    ui.navTo('search', { 'seller' : searchParam('pkh') });
},

'ordersTo' : function() {
    ui.navTo('orders', { 'to' : searchParam('pkh'), });
},

'ordersFrom' : function() {
    ui.navTo('orders', { 'from' : searchParam('pkh'), });
},

'trustFrom' : function() {
    ui.navTo('trust', { 'from' : searchParam('pkh'), });
},

'trustTo' : function() {
    ui.navTo('trust', { 'to' : searchParam('pkh'), });
},

'compose' : function() {
    ui.navTo('compose', { 'to' : searchParam('pkh'), });
},

};


