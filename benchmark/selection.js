var Benchmark = require("benchmark");

var LD   = require("../src/ld-query.js")
var LDO   = require("./ld-query-original.js")
var DATA = require( "./data/selection-tests.json" )
var CONTEXT = {
    "ex": "http://www.example.org#"
}

var origDoc = LDO(DATA, CONTEXT);
var newDoc = LD(DATA, CONTEXT);

var suite = new Benchmark.Suite;

suite
    .add("original selection test", function() {

        origDoc.queryAll( "ex:grabThis @value" );

    })
    .add("original uncached selection test", function() {

        LDO(DATA, CONTEXT).queryAll( "ex:grabThis @value" );

    })
    .add("selection test", function() {

        newDoc.queryAll( "ex:grabThis @value" );

    })
    .add("uncached selection test", function() {

        LD(DATA, CONTEXT).queryAll( "ex:grabThis @value" );

    })
    .on("complete", function() {

        console.log(this.map(function(x) {
            return x.name + ": " + x.stats.mean;
        }).join("\n"));
        
    })
    .run();
;

