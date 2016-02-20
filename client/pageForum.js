
aq.page.forumList = {
'needKeys' : false,

'init' : function() {
    var mc = aq.getStorage('marketControl').msg;

    var fb = $('#forumList-body');
    mc.forums.forEach(function(f) {
        var tr = $('<tr/>'), td = $('<td/>'),
            a  = $('<a/>', { 'text' : f,
                             'href' : '?a=forum&f=' + encodeURI(f) });
        a.appendTo(td);
        td.appendTo(tr);
        tr.appendTo(fb);
    });
},
};

aq.page.forum = {
'needKeys' : false,

'init' : function() {
    var f = searchParam('f'), ref = searchParam('ref'), topLevel;
    if(ref) {
        $('#forum-postings').css('display', 'none');
        $('#forum-post').text('Broadcast New Forum Reply');
        topLevel = false;
    } else {
        $('#forum-replies').css('display', 'none');
        $('#forum-parent').css('display', 'none');
        $('#forum-post').text('Broadcast New Forum Post');
        ref = f;
        topLevel = true;
    }
    $('#forum-title').text(f);
    $('#forum-postings').css('width', '700px');

    $('#forum-subject')[0].value = '';
    $('#forum-body')[0].value = '';
    if(!topLevel) {
        $('#forum-compose').css('padding-left', '30px');
    }

    function trForPostSummary(m, uri) {
        var tr = $('<tr/>');

        var a = $('<td/>', { 'text' : timeAgo(m.timeReal) });
        a.appendTo(tr);
        a.css('width', '40px');
        var f = $('<td/>');
        ui.addressDiv(m.sigFrom).appendTo(f);
        f.appendTo(tr);
        f.css('width', '120px');

        var sa = $('<a/>', { 'text' : m.subject, 'href' : uri }),
            std = $('<td/>');
        sa.appendTo(std);
        std.appendTo(tr);
        return tr;
    }
    function tableForCompletePost(m, reply) {
        return ui.commentTable(m, { 'isReply' : reply });
    }

    var have = { }, haveParent = false;

    if(!topLevel) {
        aq.rpc.toServers('searchMsg', {
            'hashInclude' : [ ref ],
            'resultsAs'   : 'msg',
        }, function(r) {
            if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;
            if(r.result.msgs.length !== 1) return;
            var m = r.result.msgs[0];
            if(haveParent || m.hash !== ref) return;
            haveParent = true;

            var table = tableForCompletePost(m);
            table.appendTo('#forum-parent');

            aq.asyncVerifyMsgSignatures(m, table);

            $('#forum-subject')[0].value = m.subject;
            $('#forum-body')[0].value = '';
        }, null);
    }

    aq.rpc.toServers('searchMsg', {
        'type'         : 'publicComment',
        'ref'          : ref,
        'skipResults'  : searchParam('skip')|0,
        'limitResults' : conf.postsPerPage,
        'resultsAs'    : 'msg',
        'sortBy'       : topLevel ? 'timeForum' : 'timeReal',
    }, function(r) {
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.msgs))) return;

        var fpb = $('#forum-postings-body');

        r.result.msgs.forEach(function(m) {
            if(have[m.hash]) return;
            have[m.hash] = true;

            var elem;
            if(topLevel) {
                var uri = '?a=forum&f=' + encodeURI(f) +
                                '&ref=' + encodeURI(m.hash);
                elem = trForPostSummary(m, uri);
                elem.appendTo('#forum-postings');
            } else {
                elem = tableForCompletePost(m, true);
                elem.appendTo('#forum-replies');
            }

            aq.asyncVerifyMsgSignatures(m, elem);
        });
        if(Object.keys(have).length === 0) {
            have['empty-forum'] = true;

            if(topLevel) {
                var tr = $('<tr/>');
                $('<td/>', { 'text'    : 'no posts yet in this forum',
                             'colspan' : 3 }).appendTo(tr);
                tr.appendTo(fpb);
            }
        }

        var copy = [ 'f', 'ref' ];
        ui.pageControls('#forum', copy, topLevel ? 'posts ' : 'replies ',
            r.result.skipped, r.result.msgs.length, r.result.n,
            conf.postsPerPage);

        ui.hidePopup();
    }, null);

    ui.showPopup('log');
},

'post' : function() {
    var keys = aq.getStorage('keys');
    if(!keys) {
        ui.navTo('keys');
        return;
    }

    var subject = $('#forum-subject')[0].value,
        body = $('#forum-body')[0].value,
        ref = searchParam('ref') || searchParam('f');

    if(subject.length < 10 || body.length < 10) {
        ui.showPopup('notify', 'Subject or body too short.');
        return;
    }

    var pc = {
        'type'      : 'publicComment',
        'subject'   : subject,
        'body'      : body,
        'ref'       : ref,
    };
    aq.finishAndSendMsg(pc, function() { ui.navReload(); });
},

};
