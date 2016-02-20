
aq.page.trust = {

'needKeys' : true,

'init' : function() {
    var keys = aq.getStorage('keys');

    var to = searchParam('to'), from = searchParam('from');
    if(to === 'me') {
        to = keys.primary;
        $('#trust-title').text('View Feedback Received For Me');
    } else if(from === 'me') {
        $('#trust-title').text('View Feedback Left By Me');
        from = keys.primary;
    }

    $('#trust-from')[0].value = (from || '');
    $('#trust-to')[0].value = (to || '');

    var p = {
        'type'         : 'trust',
        'limitResults' : conf.trustsPerPage,
        'skipResults'  : (searchParam('skip')|0),
    };
    if(to) p.to = to;
    if(from) p.sigFrom = [ from ];
    aq.getMsgsBySearch(p, function(r, page) {
        r.forEach(function(m) {
            if(to && (m.to !== to)) return
            if(from && (m.sigFrom !== from)) return
            if(m.type !== 'trust') return;

            var tr = $('<tr/>');
            $('<td/>', { 'text' : timeAgo(m.timeReal) }).appendTo(tr);
            ui.wrapTd(ui.addressDiv(m.sigFrom)).appendTo(tr);
            ui.wrapTd(ui.addressDiv(m.to)).appendTo(tr);
            var tdc = $('<td/>'), divc = $('<div/>', { 'text' : m.comment });
            divc.css('max-width', '160px');
            divc.css('overflow', 'hidden');
            divc.appendTo(tdc);
            tdc.appendTo(tr);
            var score = m.score.toFixed(1);
            if(m.score > 0) score = '+' + score;
            $('<td/>', { 'text'  : score }).appendTo(tr);
            var ol = $('<a/>', {
                'class' : 'mono wrap',
                'text'  : m.order,
                'href'  : '?a=order&hash=' + encodeURI(m.order),
            }),
                otd = $('<td/>', { 'class' : 'mono wrap' });
            ol.appendTo(otd);
            otd.appendTo(tr);

            tr.appendTo('#trust-msgs');
            aq.asyncVerifyMsgSignatures(m, tr);
        });
        var copy = [ 'to', 'from' ];
        ui.pageControls('#trust', copy, 'feedbacks ',
            page.skipped, page.inPage, page.total, conf.trustsPerPage);
        ui.hidePopup();
    });
},

'search' : function() {
    ui.navTo('trust', {
        'from' : $('#trust-from')[0].value,
        'to'   : $('#trust-to')[0].value,
    });
},

};


aq.page.trustNew = {

'needKeys' : true,

'init' : function() {
    var keys = aq.getStorage('keys');
    $('#trustNew-from').text(keys.primary);

    var order = searchParam('order'), to = searchParam('to');
    if(order && to) {
        var io = $('#trustNew-order')[0], it = $('#trustNew-to')[0];
        io.value = order;
        it.value = to;
        io.readOnly = true;
        it.readOnly = true;

        // Prompt the user to delete old feedback if necessary to replace
        aq.getMsgBySearch({
            'type'    : 'trust',
            'to'      : to,
            'sigFrom' : [ keys.primary ],
        }, function(r) {
            if(!r) return;

            ui.showPopup('trustDel');
            $('#trustDel-delete').on('click', function() {
                var m = {
                    'type'     : 'deleteMessage',
                    'toDelete' : r.hash,
                    'comment'  : 'delete trust before replacing'
                };
                aq.finishAndSendMsg(m, function() {
                    ui.hidePopup();
                });
            });
        });
        ui.hidePopup();
    }
},

'post' : function() {
    var m = {
        'type'    : 'trust',
        'score'   : ($('#trustNew-score')[0].value*1),
        'to'      : $('#trustNew-to')[0].value,
        'order'   : $('#trustNew-order')[0].value,
        'comment' : $('#trustNew-comment')[0].value,
    };
    aq.finishAndSendMsg(m, function() {
        var keys = aq.getStorage('keys');
        ui.navTo('trust', { 'from' : keys.primary });
    });
},

};


