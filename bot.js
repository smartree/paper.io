if (process.argv.length < 3) {
	console.log("Usage: node bot.js <socket-url> [<name>]")
	process.exit(1);
}

//TODO: add a land claiming algo (with coefficient parameters)
//TODO: add weight to the max land area and last land area, and also the number of kills
//TODO: genetic gene pooling

var core = require("./src/core");
var client = require("./src/game-client");
var consts = require("./config.json").consts;

var MOVES = [[-1, 0], [0, 1], [1, 0], [0, -1]];

var AGGRESSIVE = Math.random();
var THRESHOLD = 10;

var startFrame = -1;
var endFrame = -1;
var coeffs = [0.6164220147940495, -2.519369747858328, 0.9198978109542851, -1.2158956330674564, -3.072901620397528, 5, 4];
var grid, others, user, playerPortion = {};
var DIST_TYPES = {
	land: {
		check: function(loc) {
			return grid.get(loc.row, loc.col) === user;
		},
		coeff: function() {
			return coeffs[0];
		}
	}, tail: {
		check: function(loc) {
			return tail(user, loc)
		},
		coeff: function() {
			return coeffs[1];
		}
	}, oTail: {
		check: foundProto(tail),
		coeff: function() {
			return AGGRESSIVE * coeffs[2];
		}
	}, other: {
		check: foundProto(function(other, loc) {
			return other.row === this.row && other.col === this.col;
		}),
		coeff: function() {
			return (1 - AGGRESSIVE) * coeffs[3];
		}
	}, edge: {
		check: function(loc) {
			return loc.row <= 1 || loc.col <= 1 || loc.row >= consts.GRID_COUNT - 1 || loc.col >= consts.GRID_COUNT - 1
		},
		coeff: function() {
			return coeffs[4];
		}
	}
};

function log(msg) {
	return console.log(`[${new Date()}] ${msg}`);
}

function generateLandDirections() {
	function mod(x) {
		x %= 4;
		if (x < 0) x += 4;
		return x;
	}

	var breadth = Math.floor(Math.random() * coeffs[5]) + 1;
	var spread = Math.floor(Math.random() * coeffs[6]) + 1;
	var extra = Math.floor(Math.random() * 2) + 1;
	var ccw = Math.floor(Math.random() * 2) * 2 - 1;

	var dir = user.currentHeading;
	var turns = [dir, mod(dir + ccw), mod(dir + ccw * 2), mod(dir + ccw * 3)];
	var lengths = [breadth, spread, breadth + extra, spread];

	var moves = [];
	for (var i = 0; i < turns.length; i++) {
		for (var j = 0; j < lengths[i]; j++) {
			moves.push(turns[i]);
		}
	}
}

var LAND_CLAIMS = {
	rectDims: function() {},
	rectSpread: function() {}
}

function foundProto(func) {
	return function(loc) {
		return others.some(function(other) {
			return func(other, loc);
		});
	}
}

function connect() {
	var prefixes = consts.PREFIXES.split(" ");
	var names = consts.NAMES.split(" ");
	var name = process.argv[3] || ["[BOT]", prefixes[Math.floor(Math.random() * prefixes.length)], names[Math.floor(Math.random() * names.length)]].join(" ");
	client.connectGame(process.argv[2], name, function(success, msg) {
		if (!success) setTimeout(connect, 1000);
	});
}

function Loc(row, col, step) {
	if (this.constructor != Loc) return new Loc(row, col, step);
	this.row = row;
	this.col = col;
	this.step = step;
}

//Projects vector b onto vector a
function project(a, b) {
	var factor = (b[0] * a[0] + b[1] * a[1]) / (a[0] * a[0] + a[1] * a[1]);
	return [factor * a[0], factor * a[1]];
}

function tail(player, loc) {
	return player.tail.hitsTail(loc);
}

function traverseGrid(dir) {
	steps = new Array(consts.GRID_COUNT * consts.GRID_COUNT);
	for (var i in steps) {
		steps[i] = -1;
	}

	distWeights = {};
	for (var type in DIST_TYPES) {
		distWeights[type] = 0;
	}

	var row = user.row, col = user.col;
	var minRow = Math.max(0, row - 10), maxRow = Math.min(consts.GRID_COUNT, row + 10);
	var minCol = Math.max(0, col - 10), maxCol = Math.min(consts.GRID_COUNT, col + 10);

	var proj = 0;
	for (var i = 1; i >= -1; i-=2) {
		proj = (1 + THRESHOLD) * i;
		while (proj != 0) {
			proj -= i;
			var normRange = Math.abs(proj);
			for (var norm = -normRange; norm <= normRange; norm++) {
				for (var distType in distWeights) {
					var move = MOVES[dir];
					var delta = THRESHOLD - Math.abs(proj);
					var dist = Math.sign(proj) * delta * delta / (Math.abs(norm) + 1)
					var loc = {row: proj * move[0] + norm * move[1], col: proj * move[1] + norm * move[0]};

					loc.row += user.row;
					loc.col += user.col;

					if (loc.row < 0 || loc.row >= consts.GRID_COUNT || loc.col < 0 || loc.col >= consts.GRID_COUNT) continue;
					if (DIST_TYPES[distType].check(loc)) distWeights[distType] += dist;
				}
			}
		}
	}
	return distWeights;
}

function printGrid() {
	var chars = new core.Grid(consts.GRID_COUNT);
	for (var r = 0; r < consts.GRID_COUNT; r++) {
		for (var c = 0; c < consts.GRID_COUNT; c++) {
			if (tail(user, {row: r, col: c})) chars.set(r, c, "t");
			else {
				var owner = grid.get(r, c);
				chars.set(r, c, owner ? "" + owner.num % 10 : ".");
			}
		}
	}

	for (var p of others) {
		chars.set(p.row, p.col, "x");
	}
	chars.set(user.row, user.col, "^>V<"[user.currentHeading]);

	var str = "";
	for (var r = 0; r < consts.GRID_COUNT; r++) {
		str += "\n";
		for (var c = 0; c < consts.GRID_COUNT; c++) {
			str += chars.get(r, c);
		}
	}
	log(str);
}

function update(frame) {
	if (startFrame == -1) startFrame = frame;
	endFrame = frame;
	if (frame % 6 == 1) {
		grid = client.grid;
		others = client.getOthers();
		//printGrid();
		var weights = [0, 0, 0, 0];
		for (var d of [3, 0, 1]) {
			var weight = 0;

			d = (d + user.currentHeading) % 4;
			distWeights = traverseGrid(d);

			var str = d + ": "
			for (var distType in DIST_TYPES) {
				var point = distWeights[distType] * DIST_TYPES[distType].coeff();
				weight += point;
				str += distType + ": " + point + ", ";
			}
			//log(str);
			weights[d] = weight;
		}

		var low = Math.min(0, Math.min.apply(this, weights));
		var total = 0;

		weights[(user.currentHeading + 2) % 4] = low;
		for (var i = 0; i < weights.length; i++) {
			weights[i] -= low * (1 + Math.random());
			total += weights[i];
		}

		if (total == 0) {
			for (var d of [-1, 0, 1]) {
				d = (d + user.currentHeading) % 4;
				while (d < 0) d += 4;
				weights[d] = 1;
				total++;
			}
		}
		//log(weights)
		//Choose a random direction from the weighted list
		var choice = Math.random() * total;
		var d = 0;
		while (choice > weights[d]) {
			choice -= weights[d++];
		}
		client.changeHeading(d);
	}
}

function calcFavorability(params) {
	return params.portion + params.kills * 50 + params.survival / 100;
}

client.allowAnimation = false;
client.renderer = {
	addPlayer: function(player) {
		playerPortion[player.num] = 0;
	},
	disconnect: function() {
		var dt = (endFrame - startFrame);
		startFrame = -1;
		log(`I died... (survived for ${dt} frames.)`);
		log(`I killed ${client.kills} player(s).`);
		log("Coefficients: " + coeffs);

		var mutation = Math.min(10, Math.pow(2, calcFavorability(params)));
		for (var i = 0; i < coeffs.length; i++) {
			coeffs[i] += Math.random() * mutation * 2 - mutation;
		}
		connect();
	},
	removePlayer: function(player) {
		delete playerPortion[player.num];
	},
	setUser: function(u) {
		user = u;
	},
	update: update,
	updateGrid: function(row, col, before, after) {
		before && playerPortion[before.num]--;
		after && playerPortion[after.num]++;
	}
};

connect();