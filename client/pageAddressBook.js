
aq.page.addressBook = {

'needKeys' : true,

'init' : function() {
    var ab = aq.getStorage('addressBook'), pkhShow = searchParam('pkh');
    if(!ab) ab = { };
    if(pkhShow) {
        $('#addressBook-new-addr')[0].value = pkhShow;
        $('#addressBook-new-nickname')[0].value =
            (pkhShow in ab) ? ab[pkhShow] : '';
    }

    var pkhs = Object.keys(ab), cbs = [ ];
    pkhs.sort(function(a, b) {
        if(a === b) return 0;
        if(a === pkhShow) return -1;
        if(b === pkhShow) return  1;
        return (ab[a] > ab[b]) ? 1 : -1;
    });
    pkhs.forEach(function(pkh) {
        var tr = $('<tr/>');
        var td = $('<td/>'), a = $('<a/>', {
            'text' : pkh,
            'class' : 'mono',
            'href' : '?a=user&pkh=' + encodeURI(pkh),
        });
        a.css('color', 'inherit');
        a.appendTo(td);
        td.appendTo(tr);
        $('<td/>', { 'text' : ab[pkh] }).appendTo(tr);
        var td = $('<td/>'), cb = $('<input/>', { 'type' : 'checkbox' });
        cb.appendTo(td);
        td.appendTo(tr);
        tr.appendTo('#addressBook-body');
        if(pkh === pkhShow) {
            tr.addClass('hl');
        }

        cbs.push([ cb, pkh ]);
    });
    if(pkhs.length === 0) {
        var tr = $('<tr/>');
        $('<td/>', { 'text'    : 'no nicknames yet',
                     'colspan' : 3 }).appendTo(tr);
        tr.appendTo('#addressBook-body');
    }
    $('#addressBook-delete').on('click', function() {
        var ab = aq.getStorage('addressBook');
        if(!ab) ab = { };

        var deleted = false;
        cbs.forEach(function(cb) {
            if(cb[0][0].checked) {
                delete ab[cb[1]];
                deleted = true;
            }
        });
        if(deleted) {
            aq.setStorage('addressBook', ab);
            ui.navTo('addressBook');
        } else {
            ui.showPopup('notify', 'No nicknames selected to delete.');
        }
    });
},

'add' : function() {
    var pkh  = $('#addressBook-new-addr')[0].value,
        nick = $('#addressBook-new-nickname')[0].value;
    if(!cutil.checker.btcAddr(pkh)) {
        ui.showPopup('notify', 'Not a Bitcoin address.');
        return;
    }
    if(nick.length === 0) {
        ui.showPopup('notify', 'Nickname must not be empty.');
        return;
    }
    var ab = aq.getStorage('addressBook');
    if(!ab) ab = { };
    ab[pkh] = nick;
    aq.setStorage('addressBook', ab);
    ui.navTo('addressBook');
},

};

