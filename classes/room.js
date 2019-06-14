var Roles = require('./roles.js');

class Room {
    constructor(name){
        this.name = name;
        this.player_list = [];
        this.mitomane_riconosce_assassini = false;
        this.testimoni_si_riconoscono = false;
        this.game_started = false;
        this.vote_ended = false;
        this.configurazioni = [
            [""], //0
            [""], //1
            [""], //2
            ["Cittadino", "Testimone", "Testimone", "Assassino", "Mitomane", "Investigatore"], //3
            ["Cittadino", "Testimone", "Testimone", "Assassino", "Mitomane", "Investigatore", "Investigatrice"], //4
            ["Cittadino", "Testimone", "Testimone", "Assassino", "Assassino", "Mitomane", "Investigatore", "Investigatrice"], //5
            ["Cittadino", "Cittadino", "Testimone", "Testimone", "Assassino", "Assassino", "Mitomane", "Investigatore", "Investigatrice"], //6
            ["Cittadino", "Cittadino", "Testimone", "Testimone", "Testimone", "Assassino", "Assassino", "Mitomane", "Investigatore", "Investigatrice"], //7
            ["Cittadino", "Cittadino", "Testimone", "Testimone", "Testimone", "Assassino", "Assassino", "Assassino", "Mitomane", "Investigatore", "Investigatrice"], //8
            [""], //9
            [""]  //10
        ];
    }

    get player_number() {
        return this.player_list.filter(x => x.is_online).length
    }

    get owner() {
        return this.player_list.find(x => x.is_owner == true);
    }

    // assignRoles() {

    // }

    // gameStart() {
    //     this.assignRoles();
    // }
}

module.exports = Room;

