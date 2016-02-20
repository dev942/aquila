
aq.page.index = {

'needKeys' : false,

'init' : function() {
    var latest = 0, mc = aq.getStorage('marketControl').msg;

    function gotOne(r) {
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;
        if(r.result.msgs.length !== 1) return;
        var pc = r.result.msgs[0];
        if(!(pc.type === 'publicComment' &&
             pc.ref  === 'userInfo' &&
             pc.sigFrom === mc.adminPkh[0]))
        {
            return;
        }
        if(pc.timeReal <= latest) return;
        latest = pc.timeReal;
        if(!aq.verifyMsgSignatures(pc)) return;

        ui.hidePopup();
        var ct = ui.commentTable(pc);
        ct.appendTo('#index-info');
    }
    function gotAll() {
        if(latest === 0) {
            ui.log('*** the admins have not published market info, odd');
        }
    }

    aq.rpc.toServers('searchMsg', { 'type'         : 'publicComment',
                                    'ref'          : 'userInfo',
                                    'sigFrom'      : [ mc.adminPkh[0] ],
                                    'resultsAs'    : 'msg',
                                    'limitResults' : 1 }, gotOne, gotAll);
    ui.showPopup('log');

},

};
