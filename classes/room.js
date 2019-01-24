class Room {
    constructor(name){
        this.name = name;
        this.player_list = [];
    }

    get player_number() {
        return this.player_list.length;
    }

    get owner() {
        return this.player_list.find(o => o.is_owner == true);
    }
}

module.exports = Room;