var buffer = require ( 'buffer' );
var misc = require ( './misc.js' );
var opcodes = require ( './opcodes.js' );

function make_row ( type, val ) {
  return { type : type, val : val };
  }

function expand_li ( rows ) {
  var out = [];
  for ( var r in rows ) {
    var row = rows[r];
    if ( row.type === 'li' ) {
      out.push ( make_row ( 'cmd', [ 'li_w', [ ] ] ) );
      out.push ( make_row ( 'literal', row.val ) );
      }
    else {
      out.push ( row );
      }
    }
  return out;
  }

function expand_vars ( rows ) {
  // This function works by simulating the operations the virtual machine will
  // actually perform, and then extracts the stack location of variables from
  // that simulation.

  // This is more robust, and actually produces the correct result in all
  // currently used cases, compared to counting temporary values, which assumes
  // variables are not created while there are temporary values.

  // TODO(kzentner): Add some checks that simulated stack is the same before
  // and after a branch or jump. Of course, this condition should already be
  // true in correct code output, but a check here would help debugging.

  // This is the simulated stack. It will contain variable names, and 0 (which
  // is used to represent temporary values).
  var stack = [];
  var v;
  var TEMP = 0;

  var out = [];
  for ( var r in rows ) {
    var row = rows[r];
    if ( row.type === 'res' ) {
      // The top values on the stack have been declared to be a variable.
      var to_remove = stack.slice ( -row.val.length );
      for ( var k in to_remove ) {
        misc.assert ( to_remove[k] === TEMP,
                      'Only temporary values should become variables.' );
        }

      // Replace the top row.val.length temporaries with variables.
      stack = stack.slice ( 0, -row.val.length );
      for ( v in row.val ) {
        stack.push ( row.val [ v ] );
        }
      }
    else if ( row.type === 'cmd' ) {
      var args = row.val[1].slice();

      // Expand the variables.
      for ( v in args ) {
        // Replace only variables, not labels.
        if ( typeof args[v] === 'string' && args[v][0] !== '.' ) {
          args[v] = stack.length - stack.lastIndexOf ( args[v] ) - 1;
          }
        }

      // Calculate the stack movement caused by this opcode. If it's positive,
      // add that many temporaries to the top of the stack.
      var cmd = row.val[0];
      var movement = 0;
      // The call_1 and stack_1 opcodes have variable stack movement, depending
      // on their arguments.
      if ( cmd === 'call_1' ) {
        movement = -row.val[1][0];
        }
      else if ( cmd === 'stack_1' ) {
        movement = row.val[1][0];
        }
      else {
        movement = opcodes.stack[opcodes.op[cmd].code];
        }
      if ( movement >= 0 ) {
        for ( var i = 0; i < movement; i++ ) {
          stack.push ( TEMP );
          }
        }
      else {
        stack = stack.slice ( 0, stack.length + movement );
        }

      out.push ( make_row ( 'cmd', [ cmd, args ] ) );
      }
    else {
      // Propagate all other unmatched rows.
      out.push ( row );
      }
    }
  return out;
  }

function max_size_row ( row ) {
  if ( row.type === 'cmd' ) {
    return 1;
    }
  else if ( row.type === 'literal' ) {
    return 2;
    }
  else if ( row.type === 'bz' ) {
    return 2;
    }
  else if ( row.type === 'j' ) {
    return 2;
    }
  else {
    return 0;
    }
  }

function max_distance ( rows, start, label ) {
  var dist = 0;
  var i;
  var row;

  for ( i = start; i < rows.length; i++ ) {
    row = rows[i];
    if ( row.type === 'label' && row.val === label ) {
      return dist;
      }
    dist += max_size_row ( row );
    }

  // Didn't find it going forwards, search backwards.
  dist = 0;
  for ( i = start; i >= 0; i-- ) {
    row = rows[i];
    if ( row.type === 'label' && row.val === label ) {
      return dist;
      }
    dist += max_size_row ( row );
    }

  throw 'Could not find label ' + label;
  }

function expand_label_1 ( label ) {
  return [ label + '[0]' ];
  }

function expand_label_2 ( label ) {
  return [ label + '[0]', label + '[1]' ];
  }

function expand_label_3 ( label ) {
  return [ label + '[0]', label + '[1]', label + '[2]' ];
  }

function expand_bz_and_j ( rows ) {
  var out = [];
  for ( var r in rows ) {
    var row = rows[r];
    var label;
    var max_dist;
    if ( row.type === 'bz' ) {
      label = row.val;
      max_dist = max_distance ( rows, r, label );
      if ( max_dist < Math.pow ( 2, 7 ) ) {
        out.push ( make_row ( 'cmd', [ 'bz_1', expand_label_1 ( label ) ] ) );
        }
      else if ( max_dist < Math.pow ( 2, 15 ) ) {
        out.push ( make_row ( 'cmd', [ 'bz_2', expand_label_2 ( label ) ] ) );
        }
      else if ( max_dist < Math.pow ( 2, 23 ) ) {
        out.push ( make_row ( 'cmd', [ 'bz_3', expand_label_3 ( label ) ] ) );
        }
      else {
        out.push ( make_row ( 'cmd', [ 'bz_w', [ ] ] ) );
        out.push ( make_row ( 'literal', [ 'label', label ] ) );
        }
      }
    else if ( row.type === 'j' ) {
      label = row.val;
      max_dist = max_distance ( rows, r, label );
      if ( max_dist < Math.pow ( 2, 7 ) ) {
        out.push ( make_row ( 'cmd', [ 'j_1', expand_label_1 ( label ) ] ) );
        }
      else if ( max_dist < Math.pow ( 2, 15 ) ) {
        out.push ( make_row ( 'cmd', [ 'j_2', expand_label_2 ( label ) ] ) );
        }
      else if ( max_dist < Math.pow ( 2, 23 ) ) {
        out.push ( make_row ( 'cmd', [ 'j_3', expand_label_3 ( label ) ] ) );
        }
      else {
        out.push ( make_row ( 'cmd', [ 'j_w', [ ] ] ) );
        out.push ( make_row ( 'literal', [ 'label', label ] ) );
        }
      }
    else {
      out.push ( row );
      }
    }
  return out;
  }

var BUNCH_SIZE = 4;

var root = {
  make_patch : function make_patch ( obj, rows ) {
    // TODO(kzentner): Actually create a patch here.
    var buf = new buffer.Buffer ( rows.length * BUNCH_SIZE );
    // This makes binary diffs cleaner.
    buf.fill ( 0 );
    var fixups = [];
    return {
      buf : buf,
      fixups : fixups,
      offset : 0,
      id : obj.id,
      };
    },
  process_obj : function process_obj ( name, obj ) {
    var data = obj.data;

    data = expand_li ( data );
    data = expand_bz_and_j ( data );
    data = expand_vars ( data );

    var patch = this.make_patch ( obj, data );
    this.patches.push ( patch );
    },
  output_size : function output_size ( ) {
    // TODO(kzentner): Compute the size.
    var size = 0;
    return size;
    },
  create_pkg : function create_pkg ( map, modules, target_type ) {
    var self = this;
    this.target_type = target_type;

    map.each ( function ( name, obj ) {
      self.process_obj ( name, obj );
      } );

    var out_size = this.output_size ( );

    this.buffer = new buffer.Buffer ( out_size );
    // This makes binary diffs cleaner.
    this.buffer.fill ( 0 );

    this.write ( );

    return this.buffer;
    },
  write : function write ( ) {
    // TODO(kzentner): Implement these methods.
    // this.write_header ( );
    // this.write_patches ( );
    // this.write_fixups ( );
    },
  };

function make ( ) {
  return misc.obj_or ( {
    patches: [],
    fixups: [],
    buffer: null,
    buffer_idx: 0,
    offset: 0,
    },
    root );
  }

exports.make = make;