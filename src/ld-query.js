( function( x ) {

    if( typeof module === "object" && module.exports ) {

        module.exports = x;

    } else {

        window.LD = x;

    }

}( function( contextOrData, context ) {

    // if only the first parameter is supplied, then use it as the context and return a factory function
    // to create documents
    var asFactory = !context;
    context = context || contextOrData;

    // a fallback for missing Array.isArray
    var isArray = Array.isArray || function( arg ) {

        return Object.prototype.toString.call( arg ) === "[object Array]";

    };

    /*
    
        Bare property names are ones which aren't qualified with an alias or namespace
        For example, the following are considered qualified:
            ex:friendCount
            http://schema.org/name
        And the following are considered not qualified:
            name
            author
    
    */
    var barePropertyNamePattern = /^([^:]+)$/;
    
    /* 
    
        Non-expandable property names are ones which shouldn't be expanded by replacing aliases and pre-pending @vocab
        For example, the following are non-expandable property names:
            @list
            @id
        And the folowing are expandable property names:
            ex:friendCount
            name
    
    */
    var nonExpandablePropertyNames = /@.*/;
    
    /*
        Non-expandable value property names are the names of properties whose values should not be expanded by replacing aliases or prepending with @vocab
        For example, the following are non-expandable value property names:
            @list
            @index
        And the following are expandable value property names:
            @id
            @type
            ex:friendCount
            http://schema.org/name
            
    */
    var nonExpandableValuePropNamePattern = /@(?!type|id).*/;

    var stepCache = {};
    
    // this builds a set of nested functions which are capable of expanding namespace alises to full prefixes
    // if two parameters are provided then use the second parameter, otherwise use the first parameter.
    var expand = Object.keys( context )

        // for each alias (e.g. "so"), create a function to add to our chain
        .reduce( function( prior, maybeAlias ) {

            var isVocab = maybeAlias === "@vocab";
            
            // create a regex for this alias or @vocab
            var pattern = isVocab 
                ? barePropertyNamePattern // look for bare properties
                : new RegExp( "^" + maybeAlias + ":", "g" ); // look for the alias
                
            // what to replace it with
            var replacement = isVocab
                ? context[ "@vocab" ] + "$1" // just prepend the @vocab
                : context[ maybeAlias ]; // this replaces the alias part
                
            // return a new function to process the property name
            return function( propName ) {

                // if it shouldn't be expanded, bail out    
                if ( nonExpandablePropertyNames.test( propName ) ) { return propName; }

                // if there are already functions in the chain, call them first
                if ( prior ) { propName = prior( propName ); }

                // then return the result of de-aliasing this alias
                return ( propName || "" ).replace( pattern, replacement );

            };

        }, null );

    function arrayRange( arr ) {

        var len = arr.length;

        var list = [];
        
        if ( 0 < len ) {

            while ( len-- ) {
                
                list.push(len);
                
            }

        }

        return list;
    }

    function objectProps( o ) {
        var ret = [];
        for ( var p in o ) { ret.push(p); }
        return ret;
    }

    function StackFrame( parent, key, ctx ) {

        var ret;
        if ( isArray( ctx ) ) {

            if ( "@type" === key ) {
                
                ret = {
                    type: "leaf",
                    context: ctx,
                    index: -1,
                    key: key,
                    items: []
                };

            } else {

                ret = {
                    type: "array",
                    context: ctx,
                    index: -1,
                    key: key,
                    items: arrayRange(ctx)
                };

            }
            
        } else if ( "object" === typeof ctx ) {

            var keys = Object.keys(ctx);
            keys.reverse();
            ret = {
                type: "object",
                context: ctx,
                index: -1,
                key: key,
                items: keys
            };

        } else {

            ret = {
                type: "leaf",
                context: ctx,
                index: -1,
                key: key,
                items: []
            }

        }

        if ( "array" === parent.type ) {
            
            ret.index = key;
            ret.key = parent.key;

        }

        return ret;
    }
    
    function walk(doc, stepf, self) {
        self = self || this;
        
        var stack = [ StackFrame( {}, "#document", doc ) ];
        var stepId = 0;
        var path = [{
            id: stepId++,
            type: "object",
            context: undefined,
            key: "#document",
            value: doc
        }];

        while ( 0 < stack.length ) {

            var frame = stack[ stack.length - 1 ];
            var items = frame.items;

            if ( 0 === items.length ) {

                if ( "array" !== frame.type ) { path.pop(); }
                stack.pop();
                continue;

            }

            var item = items.pop();
            var value = frame.context[ item ];
            var newFrame = StackFrame( frame, item, value );

            if ( "array" === newFrame.type ) {

                stack.push( newFrame );
                continue;
                
            }
            
            path.push({
                id: stepId++,
                type: newFrame.type,
                context: frame.context,
                key: newFrame.key,
                index: newFrame.index,
                value: value
            });
            
            stepf.call( self, path )

            if ( "leaf" === newFrame.type ) {

                path.pop();
                
            } else {

                stack.push( newFrame );
                
            }
        }

        return self;
    }

    function testPathKey( nodePathEntry, stepKey, stepValue ) {

        var pathValue = nodePathEntry[ stepKey ];
        if ( !pathValue ) { return false; }
        if ( isArray( stepValue ) ) {

            var pathValueArray = isArray(pathValue) ? pathValue : [pathValue];
            return stepValue.every( function( value ) {

                return ~pathValueArray.indexOf( value );

            } );

        }
        else if ( isArray( pathValue ) ) {

            return ~pathValue.indexOf(stepValue)

        }
        return pathValue === stepValue;

    }

    function findNextPathMatch( nodePath, start, step ) {
        var i = start;
        for ( var i = start; -1 < i; i-- ) {

            var node = nodePath[ i ];
            var nodeVal = node.value;
            var stepPath = step.path;
            // check whether all keys in step ( path & @attributes ) match
            var test =
                ( "undefined" === typeof stepPath || stepPath === node.key )
                && step.tests.every( function( test ) {

                    return testPathKey( nodeVal, test.key, test.expected );

                });
            
            if ( test ) { break; }

        }

        return i;

    }

    function assessPathForSteps( steps ) {
        var tests = (steps || []);
        
        return function assessPath( nodePath ) {
            if ( !nodePath ) { return false; }
            
            var bookmark = nodePath.length;
            var directChild = false;
            var first = true;
            
            return tests.every( function( step ) {
                if ( step.directChild ) {

                    directChild = true;
                    return true;

                } else {
                    var start = bookmark - 1;
                    // find the next step starting after the bookmarked offset
                    var found = findNextPathMatch(nodePath, start, step);
                    if ( first ) {

                        if ( found !== start ) {

                            return false;
                            
                        }

                        first = false;
                    }
                    // if the directChild flag is set, only pass if the found is beside the last bookmark...
                    if ( directChild ) {

                        if ( bookmark !== found + 1 ) { return false; }
                        directChild = false;

                    }

                    bookmark = found;

                    // ...otherwise any match is fine
                    return ~bookmark;

                }

            } );

        };

    }

    function collectPaths( json ) {
        var stepf = function( path ) { this.push( [].concat( path ) ); };

        return walk( json, stepf, [] );
    }

    function cachedWalk( paths, steps, isSeekAll ) {

        var assess = assessPathForSteps( steps );
        var result = isSeekAll ? [] : null;
        var path;
        for ( var ii = 0; ii < paths.length; ii++ ) {

            path = paths[ ii ];
            if ( assess( path ) ) {

                var found;
                if ( steps[0].path === "@type" ) {

                    found = path[ path.length - 2 ].value["@type"];

                } else {
                
                    found = path[ path.length - 1 ].value;

                }
                
                if ( !isSeekAll ) {

                    return found;
                    
                }
                result.push( found );

            }            
            
        }
        return result;
    }

    
    function extractStep( path, steps ) {

        // try and extract a 'where' [@attribute=value] part from the start of the string
        var wherePart = /^(\s*\*?)\[(.+?)=(.+?)\](.*)/.exec( path );
        if ( wherePart ) {

            if ( wherePart[ 1 ] ) { steps.push( { path: undefined, directChild: false, tests: []} ); }
            var step = { key : wherePart[ 2 ].trim(), value: wherePart[ 3 ].trim() };
            if ( !nonExpandableValuePropNamePattern.test( step.key ) ) { step.value = expand( step.value ); }
            steps.push( step );
            return ( wherePart[ 4 ] || "" );

        }
        // try and extract a > part from the start of the string
        var directChildPart = /^\s*>\s*(.*)/.exec( path );
        if ( directChildPart ) {

            steps.push( { path: undefined, directChild: true, tests: [] } );
            return directChildPart[ 1 ];

        }
        // try and extract a path from the start of the string
        var pathPart = /^(.+?)( .*|\[.*|>.*)/.exec( path );
        if ( pathPart ) {

            steps.push( {
                path: expand( pathPart[ 1 ].trim()),
                directChild: false,
                tests: []
            } );
            return pathPart[ 2 ];

        }
        // assume whatever is left is a path
        steps.push( {
            path: expand( path.trim() ),
            directChild: false,
            tests: []
        } );
        return "";

    }

    function getSteps( path ) {

        var steps = stepCache[path];
        if (steps) {

            return steps;
            
        }
        
        // cut the path up into separate pieces;
        var separatedSteps = [];
        var remainder = path.trim();
        while ( remainder.length > 0 ) {

            remainder = extractStep( remainder, separatedSteps );

        }

        // create an path alias '#document' to represent the root of the current QueryNode json
        steps = [ { path: "#document", directChild: false, tests: [] } ];
        // process the extracted steps, to combine 'where' steps into keys on path steps.
        separatedSteps.forEach( function( step ) {

            if ( step.key ) {

                steps[ 0 ].tests.push({ key: step.key, expected: step.value });

            } else {

                // store steps for right-to-left matching
                steps.unshift( step );

            }

        } );

        stepCache[path] = steps;
        
        return steps;

    }

    function getCachedPaths( state, json ) {

        if ( !state.cachePaths ) {

            return collectPaths( json );

        }
        
        var paths = state.paths;
        if ( !paths ) {
            
            paths = state.paths = collectPaths( json );

        }

        return paths;

    }
    
    // select json for this path

    function select( state, json, path, isSeekAll ) {

        var steps = getSteps( path );
        if ( !steps.length ) { return { json: null }; }
        var paths = getCachedPaths( state, json );
        var found = cachedWalk( paths, steps, isSeekAll ); 
        var lastStep = steps[ 0 ].path;
        return {

            json: found,
            isFinal: ( isSeekAll ? found.length === 0 : found === null ) ||
                !!~[ "@id", "@index", "@value", "@type" ].indexOf( lastStep )

        };

    }

    function QueryNode( jsonData, parent ) {

        this.json = function() { return jsonData; };
        var state = this._state = { cachePaths: true, paths: null };
        if ( parent ) {
            
            var pstate = parent._state;

            state.cachePaths = pstate.cachePaths;

        }
    }

    function buildQueryNode( parent ) {

        return function( json ) { return new QueryNode( json, parent ); }

    }

    QueryNode.prototype.withPathCaching = function( cache ) {
        cache = !!cache;
        this._state.cachePaths = cache;
        cache || ( this._state.paths = null );
        return this;
        
    }

    QueryNode.prototype.query = function( path ) {

        // select the json targetted by this path
        var selection = select( this._state, this.json(), path );
        // if the result is "final" (e.g. @value), just return the json raw
        return selection.isFinal ? selection.json : new QueryNode( selection.json, this);

    };
    QueryNode.prototype.queryAll = function( path ) {

        // select the json targetted by this path
        var selections = select( this._state, this.json(), path, true );

        // if the result is "final" (e.g. @value), return an array of the raw json
        return selections.isFinal ? selections.json
            : selections.json.map( buildQueryNode( this ) );

    };

    if ( asFactory ) {

        // if one parameter was supplied, return the factory function
        return function( dataContext ) {

            return new QueryNode( dataContext );

        };

    } else {

        // if two parameters were supplied, return the QueryNode directly
        return new QueryNode( contextOrData );

    }

} ) );
