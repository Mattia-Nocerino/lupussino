var socket_io = require('socket.io');
var Room = require('./classes/room.js');
var Player = require('./classes/player.js');
var io = socket_io();
var api = {};
api.io = io;

var room_list = [];

const configurazioni = [
    null, //0
    null, //1
    null, //2
    ["cittadino", "testimone", "testimone", "assassino", "mitomane", "investigatore"], //3
    ["cittadino", "testimone", "testimone", "assassino", "mitomane", "investigatore", "investigatrice"], //4
    ["cittadino", "testimone", "testimone", "assassino", "assassino", "mitomane", "investigatore", "investigatrice"], //5
    ["cittadino", "cittadino", "testimone", "testimone", "assassino", "assassino", "mitomane", "investigatore", "investigatrice"], //6
    null, //7
    null, //8
    null, //9
    null  //10
];

io.on('connection', function(socket){
    console.log('A user connected');

    socket.on('disconnect', function(){
        console.log('user disconnected');
    });

    socket.on('enter', function(data, callback){
        var new_room = room_list.find(r => r.name == data.room);
        var new_player = new Player(data.player.name);

        if (new_room == undefined){//creazione stanza         
            new_room = new Room(data.room);
            room_list.push(new_room);
            new_player.owner = true;
        }

        if (room.playerJoin(new_player)){
            //inserimento con successo, controllare anche se è online o meno...
        } else {
            //giocatore già esistente e online, sei un coglioncello!
        }
        


        //     player = player_list.find(p => p.name == data.player && p.room == data.room);
        //     if (player == undefined){
        //         player = new Player(data.player, socket.id, data.room, false);
        //     } else {
        //         console.log("Giocatore già presente nella stanza");
        //         callback(true, {is_owner: false});
        //         return;
        //     }
        // }

        // player_list.push(player);
        // socket.join(room.name);
        callback(false, {is_owner: player.is_owner});
    });

    socket.on('game', function(data, callback){
        //carico la configurazione in base al numero di giocatori nella stanza
        player_in_room = player_list.filter(c => c.room === data.room);
        if (player_in_room.length >= 3) {
            console.log(configurazioni);
            configurazione_attiva = configurazioni[player_in_room.length].slice();
            //assegno i ruoli
            //loopo i giocatori e assegno il ruolo
            for(var player of player_in_room){
                var random_item = Math.floor(Math.random() * configurazione_attiva.length);
                player.role = configurazione_attiva[random_item];
                configurazione_attiva.splice(random_item, 1);
            }
            var esiliate = configurazione_attiva;

            for(var player of player_in_room){
                var altro_testimone = '';
                var altro_assassino = '';
                switch(player.role){
                    case "cittadino":
                        detail = "Sei un semplice cittadino in una città piena di assassini... guardati le spalle";
                        break;
                    case "investigatore":
                        detail = "Hai veggiato nel mezzo: " + esiliate[Math.floor(Math.random() * esiliate.length)];
                        break;
                    case "investigatrice":
                        detail = "Hai veggiato nel mezzo: " + esiliate[Math.floor(Math.random() * esiliate.length)];
                        break;
                    case "testimone":
                        for(var t of player_in_room){
                            if (t.role == 'testimone' && t.name != player.name){
                                altro_testimone = t.name;
                            }
                        }
                        
                        if (altro_testimone == ''){
                            detail = "Sei testimone... ma da solo";
                        } else {
                            if (player_in_room.length > 5){
                                detail = "Sei testimone con " + altro_testimone;
                            } else {
                                detail = "Sei testimone e NON da solo!";
                            }
                        }
                        break;
                    case "mitomane":
                        if (player_in_room.length > 5){
                            detail = "Sei il mitomane e gli assassini sono ";
                        } else {
                            detail = "Mitomane, fatti votare (bastardo!)";
                        }
                        break;
                    case "assassino":
                        for(var a of player_in_room){
                            if (a.role == 'assassino' && a.name != player.name){
                                altro_assassino = a.name;
                            }
                        }
                        
                        if (altro_assassino == ''){
                            detail = "Sei un'assassino... ma da solo";
                        } else {
                            detail = "Sei assassino con " + altro_assassino;
                        }
                        break;
                }
                io.to(`${player.id}`).emit('role', {role: player.role, detail: detail});
            }

            
            console.log(player_in_room);
            // console.log(esiliate);
            //rispondo ai client
        }
    });
});

module.exports = api;