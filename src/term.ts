/**
 * term.js - an xterm emulator
 * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
 * Copyright (c) 2014-2015, Simon Edwards <simon@simonzone.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Originally forked from (with the author's permission):
 *   Fabrice Bellard's javascript vt100 for jslinux:
 *   http://bellard.org/jslinux/
 *   Copyright (c) 2011 Fabrice Bellard
 *   The original design remains. The terminal itself
 *   has been extended to include xterm CSI codes, among
 *   other features.
 *
 * Forked again from Christopher Jeffrey's work by Simon Edwards in 2014.
 */
  
const REFRESH_START_NULL = 100000000;
const REFRESH_END_NULL = -100000000;
const MAX_BATCH_TIME = 16;  // 16 ms = 60Hz
const REFRESH_DELAY = 100;  // ms. How long to wait before doing a screen refresh during busy times.
const WHEELSCROLL_CHARS = 3;
  
/**
 * Terminal Emulation References:
 *   http://vt100.net/
 *   http://invisible-island.net/xterm/ctlseqs/ctlseqs.txt
 *   http://invisible-island.net/xterm/ctlseqs/ctlseqs.html
 *   http://invisible-island.net/vttest/
 *   http://www.inwap.com/pdp10/ansicode.txt
 *   http://linux.die.net/man/4/console_codes
 *   http://linux.die.net/man/7/urxvt
 */

'use strict';
function trace(): void {
    try {
      throw new Error("");
    } catch (e) {
      console.log(e);
    }
}
/**
 * Shared
 */

let idCounter = 1;


/**
 * States
 */

const normal = 0;
const escaped = 1;
const csi = 2;
const osc = 3;
const charset = 4;
const dcs = 5;
const ignore = 6;
const application_start = 7;
const application = 8;

const TERMINAL_ACTIVE_CLASS = "terminal-active";
const MAX_PROCESS_WRITE_SIZE = 4096;

/*************************************************************************/

/**
 * Options
 */
interface Options {
  colors?: string[];
  convertEol?: boolean;
  termName?: string;
  geometry?: [number, number];
  cursorBlink?: boolean;
  visualBell?: boolean;
  popOnBell?: boolean;
  scrollback?: number;
  screenKeys?: boolean;
  debug?: boolean;
  useStyle?: boolean;
  physicalScroll?: boolean;
  applicationModeCookie?: string;
};

/**
 * Terminal
 */
export class Terminal {

  static brokenBold: boolean;
  
  private parent: HTMLElement = null;
  public element: HTMLElement = null;

  private cols = 80;
  private rows = 24
  private charHeight = 12; // resizeToContainer() will fix this for us.
  
  private state = 0; // Escape code parsing state.
  private refreshStart = REFRESH_START_NULL;
  private refreshEnd = REFRESH_END_NULL;

  private ybase = 0;
  private ydisp = 0;
  private x = 0;
  private y = 0;
  private savedX = 0;
  private savedY = 0;
  
  private oldy = 0;

  private cursorState = 0;       // Cursor blink state.
  
  private cursorHidden = false;
  private hasFocus = false;
    
  private queue = '';
  private scrollTop = 0;
  private scrollBottom = 23;

  // modes
  private applicationKeypad = false;
  private applicationCursor = false;
  private originMode = false;
  private insertMode = false;
  private wraparoundMode = false;
  private normal = null;

  private prefixMode = false;
  private selectMode = false;
  private visualMode = false;
  private searchMode = false;
  private entry = '';
  private entryPrefix = 'Search: ';

  // charset
  private charset = null;
  private gcharset = null;
  private glevel = 0;
  private charsets = [null];

  // stream
  private readable = true;
  private writable = true;

  private defAttr = (0 << 18) | (257 << 9) | (256 << 0); // Default character style
  private curAttr = 0;  // Current character style.

  private params = [];
  private currentParam: string | number = 0;
  private prefix = '';
  private postfix = '';
  
  private _blink = null;
  
  private lines = [];
  private _termId: number;
  
  private colors: string[];
  private convertEol: boolean;
  private termName: string;
  private geometry: [number, number];
  private cursorBlink: boolean;
  private visualBell: boolean;
  private popOnBell: boolean;
  private scrollback: number;
  private screenKeys: boolean;
  public debug: boolean;
  private useStyle: boolean;
  private physicalScroll: boolean;
  private applicationModeCookie: string;
  
  private _writeBuffers = [];  // Buffer for incoming data waiting to be processed.
  private _processWriteChunkTimer = -1;  // Timer ID for our write chunk timer.  
  private _refreshTimer = -1;  // Timer ID for triggering an on scren refresh.
  private _scrollbackBuffer = [];  // Array of lines which have not been rendered to the browser.
  private tabs: { [key: number]: boolean };
  private sendFocus = false;

  private context: Window = null;
  private document: Document = null;
  private body: HTMLElement = null;

  private isMac = false;
  private isMSIE = false;
  private children: HTMLDivElement[] = [];

  private utfMouse = false;
  private decLocator = false;
  private urxvtMouse = false;
  private sgrMouse = false;
  private vt300Mouse = false;
  private vt200Mouse = false;
  private normalMouse = false;
  private x10Mouse = false;
  private mouseEvents = false;

  private _events: { [type: string]: EventListener[]; } = {};
  private _blinker: Function = null;
  private savedCols: number;
  private title: string = "";
  private searchDown: boolean;
    
  private _selected: {
    x1: number;
    x2: number;
    y1: number;
    y2: number;
  } = null;
  
  private _real: {
    x: number;
    y: number;
    ydisp: number;
    ybase: number;
    cursorHidden: boolean;
    lines: any[];
    write: (data:any) => void;
    preVisual?: any[];
    preSearch?: any[];
    preSearchX?: number;
    preSearchY?: number;
  };

  constructor(options: Options) {
    var self = this;
    
    // Every term gets a unique ID.
    this._termId = idCounter;
    idCounter++;

    const defaults = {
      colors: Terminal.colors,
      convertEol: false,
      termName: 'xterm',
      geometry: [80, 24],
      cursorBlink: true,
      visualBell: false,
      popOnBell: false,
      scrollback: 1000,
      screenKeys: false,
      debug: false,
      useStyle: false,
      physicalScroll: false,
      applicationModeCookie: null
    };

    if (options.colors.length === 8) {
      options.colors = options.colors.concat(Terminal._colors.slice(8));
    } else if (options.colors.length === 16) {
      options.colors = options.colors.concat(Terminal._colors.slice(16));
    } else if (options.colors.length === 10) {
      options.colors = options.colors.slice(0, -2).concat(
        Terminal._colors.slice(8, -2), options.colors.slice(-2));
    } else if (options.colors.length === 18) {
      options.colors = options.colors.slice(0, -2).concat(
        Terminal._colors.slice(16, -2), options.colors.slice(-2));
    }

    this.colors = options.colors === undefined ? Terminal.colors : options.colors;
    this.convertEol = options.convertEol === undefined ? false : options.convertEol;
    this.termName = options.termName === undefined ? 'xterm' : options.termName;
    this.geometry = options.geometry === undefined ? [80, 24] : options.geometry;
    this.cursorBlink = options.cursorBlink === undefined ? true : options.cursorBlink;
    this.visualBell = options.visualBell === undefined ? false : options.visualBell;
    this.popOnBell = options.popOnBell === undefined ? false : options.popOnBell;
    this.scrollback = options.scrollback === undefined ? 1000 : options.scrollback;
    this.screenKeys = options.screenKeys === undefined ? false : options.screenKeys;
    this.debug = options.debug === undefined ? false : options.debug;
    this.useStyle = options.useStyle === undefined ? false : options.useStyle;
    this.physicalScroll = options.physicalScroll === undefined ? false : options.physicalScroll;
    this.applicationModeCookie = options.applicationModeCookie === undefined ? null : options.applicationModeCookie;

    this.colors = options.colors;

    // this.options = options;

    this.charHeight = 12; // resizeToContainer() will fix this for us.
    
    this.state = 0; // Escape code parsing state.
    this.refreshStart = REFRESH_START_NULL;
    this.refreshEnd = REFRESH_END_NULL;

    this._resetVariables();

    this._writeBuffers = [];  // Buffer for incoming data waiting to be processed.
    this._processWriteChunkTimer = -1;  // Timer ID for our write chunk timer.
    
    this._refreshTimer = -1;  // Timer ID for triggering an on scren refresh.
    this._scrollbackBuffer = [];  // Array of lines which have not been rendered to the browser.
  }

  private _resetVariables() {
    var i;
    
    this.ybase = 0;
    this.ydisp = 0;
    this.x = 0;
    this.y = 0;
    this.oldy = 0;

    this.cursorState = 0;       // Cursor blink state.
    
    this.cursorHidden = false;
    this.hasFocus = false;
    
  //  this.convertEol;
    
    this.queue = '';
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;

    // modes
    this.applicationKeypad = false;
    this.applicationCursor = false;
    this.originMode = false;
    this.insertMode = false;
    this.wraparoundMode = false;
    this.normal = null;

    // select modes
    this.prefixMode = false;
    this.selectMode = false;
    this.visualMode = false;
    this.searchMode = false;
  //  this.searchDown;
    this.entry = '';
    this.entryPrefix = 'Search: ';
  //  this._real;
  //  this._selected;
  //  this._textarea;

    // charset
    this.charset = null;
    this.gcharset = null;
    this.glevel = 0;
    this.charsets = [null];

    // mouse properties
  //  this.decLocator;
  //  this.x10Mouse;
  //  this.vt200Mouse;
  //  this.vt300Mouse;
  //  this.normalMouse;
  //  this.mouseEvents;
  //  this.sendFocus;
  //  this.utfMouse;
  //  this.sgrMouse;
  //  this.urxvtMouse;

    // misc
  //  this.element;
  //  this.children;
  //  this.savedX;
  //  this.savedY;
  //  this.savedCols;

    // stream
    this.readable = true;
    this.writable = true;

    this.defAttr = (0 << 18) | (257 << 9) | (256 << 0); // Default character style
    this.curAttr = this.defAttr;  // Current character style.

    this.params = [];
    this.currentParam = 0;
    this.prefix = '';
    this.postfix = '';
    
    this._blink = null;
    
    this.lines = [];
    if ( !this.physicalScroll) {
      for (i = 0; i< this.rows; i++) {
        this.lines.push(this.blankLine());
      }
    }
  //  this.tabs;
    this.setupStops();
  }

  // back_color_erase feature for xterm.
  eraseAttr() {
    // if (this.is('screen')) return this.defAttr;
    return (this.defAttr & ~0x1ff) | (this.curAttr & 0x1ff);
  }

  /**
   * Colors
   */

  // Colors 0-15
  static tangoColors = [
    // dark:
    '#2e3436',
    '#cc0000',
    '#4e9a06',
    '#c4a000',
    '#3465a4',
    '#75507b',
    '#06989a',
    '#d3d7cf',
    // bright:
    '#555753',
    '#ef2929',
    '#8ae234',
    '#fce94f',
    '#729fcf',
    '#ad7fa8',
    '#34e2e2',
    '#eeeeec'
  ];

  static xtermColors = [
    // dark:
    '#000000', // black
    '#cd0000', // red3
    '#00cd00', // green3
    '#cdcd00', // yellow3
    '#0000ee', // blue2
    '#cd00cd', // magenta3
    '#00cdcd', // cyan3
    '#e5e5e5', // gray90
    // bright:
    '#7f7f7f', // gray50
    '#ff0000', // red
    '#00ff00', // green
    '#ffff00', // yellow
    '#5c5cff', // rgb:5c/5c/ff
    '#ff00ff', // magenta
    '#00ffff', // cyan
    '#ffffff'  // white
  ];

  // Colors 0-15 + 16-255
  // Much thanks to TooTallNate for writing this.
  static colors = (function() {
    var colors = Terminal.tangoColors.slice();
    var r = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
    var i;

    // 16-231
    i = 0;
    for (; i < 216; i++) {
      out(r[(i / 36) % 6 | 0], r[(i / 6) % 6 | 0], r[i % 6]);
    }

    // 232-255 (grey)
    i = 0;
    for (; i < 24; i++) {
      const v = 8 + i * 10;
      out(v, v, v);
    }

    function out(r, g, b) {
      colors.push('#' + hex(r) + hex(g) + hex(b));
    }

    function hex(c) {
      c = c.toString(16);
      return c.length < 2 ? '0' + c : c;
    }

    // Default BG/FG
    colors[256] = '#000000';
    colors[257] = '#f0f0f0';
    return colors;
  })();

  static _colors = Terminal.colors.slice();

  static vcolors = (function() {
    var out = [];
    var colors = Terminal.colors;
    var i = 0;
    var color;

    for (; i < 256; i++) {
      color = parseInt(colors[i].substring(1), 16);
      out.push([
        (color >> 16) & 0xff,
        (color >> 8) & 0xff,
        color & 0xff
      ]);
    }

    return out;
  })();

  focus() {
    if (this.sendFocus) {
      this.send('\x1b[I');
    }
    this.showCursor();
    this.element.focus();
    this.hasFocus = true;
  };

  blur() {
    if (!this.hasFocus) {
      return;
    }

    this.cursorState = 0;
    this.refresh(this.y, this.y);
    if (this.sendFocus) this.send('\x1b[O');

    this.element.blur();
    this.hasFocus = false;
  };

  /**
   * Initialize global behavior
   */
  initGlobal() {
    var document = this.document;
    if (this.useStyle) {
      Terminal.insertStyle(document, this.colors[256], this.colors[257]);
    }
  };

  /**
   * Insert an extra style of adding extra padding to the last row in the terminal.
   * 
   * This is only relevant when physical scrolling is used. It is desirable
   * that the first row of the terminal align with the visible top of the
   * containing element. When using curses based programs like editors you don't want to 
   * see part of the scrollback cut off and just above the top row of your editor.
   */
  _initLastLinePadding() {
    var style;
    var doc = this.document;
    var head = doc.getElementsByTagName('head')[0];
    if (!head) {
      return;
    }

    style = doc.createElement('style');
    style.id = 'term-padding-style' + this._termId;

    // textContent doesn't work well with IE for <style> elements.
    style.innerHTML = 'DIV.' + TERMINAL_ACTIVE_CLASS + ':last-child {\n' +
      '}\n';

    head.insertBefore(style, head.firstChild);
  };

  /**
   * Set the size of the extra padding for the last row.
   * 
   * @param {number} padh The size of the pad in pixels
   */
  _setLastLinePadding = function(padh) {
    var style;
    var doc = this.document;
    style = doc.getElementById('term-padding-style' + this._termId);
    style.sheet.cssRules[0].style.paddingBottom = '' + padh + 'px';
  };

  /**
   * Bind to paste event
   */
  // bindPaste = function(document) {
  //   // This seems to work well for ctrl-V and middle-click,
  //   // even without the contentEditable workaround.
  //   var window = document.defaultView;
  //   on(window, 'paste', function(ev) {
  //     var term = Terminal.focus;
  //     if (!term) return;
  //     if (ev.clipboardData) {
  //       term.send(ev.clipboardData.getData('text/plain'));
  //     } else if (term.context.clipboardData) {
  //       term.send(term.context.clipboardData.getData('Text'));
  //     }
  //     // Not necessary. Do it anyway for good measure.
  //     term.element.contentEditable = 'inherit';
  //     return cancel(ev);
  //   });
  // };

  /**
   * Global Events for key handling
   */

  bindKeys() {
    var self = this;
    
    // We should only need to check `target === body` below,
    // but we can check everything for good measure.
    on(this.element, 'keydown', function(ev) {
      var target = ev.target || ev.srcElement;
      if (!target) {
        return;
      }
      if (target === self.element ||
          target === self.context ||
          target === self.document ||
          target === self.body ||
          // target === self._textarea ||
          target === self.parent) {
        return self.keyDown(ev);
      }
    }, true);

    on(this.element, 'keypress', function(ev) {
      var target = ev.target || ev.srcElement;
      if (!target) return;
      if (target === self.element ||
          target === self.context ||
          target === self.document ||
          target === self.body ||
          // target === self._textarea ||
          target === self.parent) {
        return self.keyPress(ev);
      }
    }, true);
  };

  /**
   * Copy Selection w/ Ctrl-C (Select Mode)
   */
  bindCopy(document) {
    
    // if (!('onbeforecopy' in document)) {
    //   // Copies to *only* the clipboard.
    //   on(window, 'copy', function fn(ev) {
    //     var term = Terminal.focus;
    //     if (!term) return;
    //     if (!term._selected) return;
    //     var text = term.grabText(
    //       term._selected.x1, term._selected.x2,
    //       term._selected.y1, term._selected.y2);
    //     term.emit('copy', text);
    //     ev.clipboardData.setData('text/plain', text);
    //   });
    //   return;
    // }

    // Copies to primary selection *and* clipboard.
    // NOTE: This may work better on capture phase,
    // or using the `beforecopy` event.
    on(this.element, 'copy', (function(ev) {
      if (!this._selected) return;
      var textarea = this.getCopyTextarea();
      var text = this.grabText(
        this._selected.x1, this._selected.x2,
        this._selected.y1, this._selected.y2);
      this.emit('copy', text);
      textarea.focus();
      textarea.textContent = text;
      textarea.value = text;
      textarea.setSelectionRange(0, text.length);
      setTimeout(function() {
        this.element.focus();
        this.focus();
      }, 1);
    }).bind(this));
  }

  /**
   * Insert a default style
   */
  static insertStyle(document, bg, fg) {
    var style = document.getElementById('term-style');
    if (style) return;

    var head = document.getElementsByTagName('head')[0];
    if (!head) return;

    style = document.createElement('style');
    style.id = 'term-style';

    // textContent doesn't work well with IE for <style> elements.
    style.innerHTML = '' +
      '.terminal {\n' +
      '  float: left;\n' +
      '  border: ' + bg + ' solid 5px;\n' +
      '  font-family: "DejaVu Sans Mono", "Liberation Mono", monospace;\n' +
      '  font-size: 11px;\n' +
      '  color: ' + fg + ';\n' +
      '  background: ' + bg + ';\n' +
      '}\n' +
      '\n' +
      '.terminal-cursor {\n' +
      '  color: ' + bg + ';\n' +
      '  background: ' + fg + ';\n' +
      '}\n';

    // var out = '';
    // each(Terminal.colors, function(color, i) {
    //   if (i === 256) {
    //     out += '\n.term-bg-color-default { background-color: ' + color + '; }';
    //   }
    //   if (i === 257) {
    //     out += '\n.term-fg-color-default { color: ' + color + '; }';
    //   }
    //   out += '\n.term-bg-color-' + i + ' { background-color: ' + color + '; }';
    //   out += '\n.term-fg-color-' + i + ' { color: ' + color + '; }';
    // });
    // style.innerHTML += out + '\n';

    head.insertBefore(style, head.firstChild);
  };

  /**
   * Effectively move all rendered rows into the physical scrollback area.
   * 
   * Visually this does nothing because the new rows for the terminal will
   * not have been rendered or added to the DOM yet. Future terminal rows 
   * will appear below the old last row in the window.
   */
  moveRowsToScrollback() {
    
    if (this.x === 0 && this.lines.length-1 === this.y) {
      if (this.getLineText(this.y).trim() === '') {
        this.lines.splice(this.lines.length-1, 1);
      }
    }
    
    this.lines.forEach(function(line) {
      this._scrollbackBuffer.push(line);
    }, this);
    
    this.lines = [];
    
    this.children.forEach(function(div) {
      div.remove();
    });
    this.children = [];
    
    this._refreshScrollback();
    
    this.refreshStart = REFRESH_START_NULL;
    this.refreshEnd = REFRESH_END_NULL;
    this.x = 0;
    this.y = 0;
    this.oldy = 0;
  };

  /**
   * Append a DOM element to the bottom of the terminal.
   * 
   * The existing rows in the terminal pushed into the scrollback area and
   * any new term rendering occurs below the placed element.
   * 
   * @param {Element} element The DOM element to append.
   */
  appendElement(element) {
    
    this.moveRowsToScrollback();
    this.element.appendChild(element);
  };

  _getLine(row) {
    while (row >= this.lines.length) {
      this.lines.push(this.blankLine());
    }
    return this.lines[row];
  };

  getDimensions() {
    return {
      rows: this.rows,
      cols: this.cols,
      materializedRows: this.lines.length,
      cursorX: this.x,
      cursorY: this.y
      };  
  };

  getLineText(y) {
    var row;
    if (y <0 || y >= this.lines.length) {
      return null;
    }
    row = this.lines[y];
      return row.map(function(tup) {
        return tup[1];
      }).join("");
  };

  _getChildDiv(y) {
    var div;
    
    while (y >= this.children.length) {
        div = this.document.createElement('div');
        div.className = TERMINAL_ACTIVE_CLASS;
        this.element.appendChild(div);
        this.children.push(div);
    }
    return this.children[y];
  };

  /**
   * Open Terminal
   */
  open(parent) {
    var self = this;
    var i = 0;

    this.parent = parent || this.parent;

    if (!this.parent) {
      throw new Error('Terminal requires a parent element.');
    }

    // Grab global elements.
    this.context = this.parent.ownerDocument.defaultView;
    this.document = this.parent.ownerDocument;
    this.body = this.document.getElementsByTagName('body')[0];

    // Parse user-agent strings.
    if (this.context.navigator && this.context.navigator.userAgent) {
      this.isMac = !!~this.context.navigator.userAgent.indexOf('Mac');
      this.isMSIE = !!~this.context.navigator.userAgent.indexOf('MSIE');
    }

    // Create our main terminal element.
    this.element = this.document.createElement('div');
    this.element.className = 'terminal';
    this.element.style.outline = 'none';
    this.element.setAttribute('tabindex', "0");
    this.element.style.backgroundColor = this.colors[256];
    this.element.style.color = this.colors[257];

    // Create the lines for our terminal.
    this.children = [];
    if ( !this.physicalScroll) {
      for (; i < this.rows; i++) {
        this._getChildDiv(i);
      }
    }
    this.parent.appendChild(this.element);

    // Draw the screen.
    if ( !this.physicalScroll) {
      this.refresh(0, this.rows - 1);
    }

    // Initialize global actions that
    // need to be taken on the document.
    this.initGlobal();

    if (this.physicalScroll) {
      this._initLastLinePadding();
    }

    // Ensure there is a Terminal.focus.
    this.focus();

    // Start blinking the cursor.
    this.startBlink();

    // Bind to DOM events related
    // to focus and paste behavior.
    on(this.element, 'focus', function() {
      self.focus();
    });

    // This causes slightly funky behavior.
    // on(this.element, 'blur', function() {
    //   self.blur();
    // });

    on(this.element, 'mousedown', function(ev: MouseEvent) {
      self.focus();
    });

    // Clickable paste workaround, using contentEditable.
    // This probably shouldn't work,
    // ... but it does. Firefox's paste
    // event seems to only work for textareas?
    on(this.element, 'mousedown', function(ev: MouseEvent) {
      var button = ev.button !== undefined ? ev.button : (ev.which !== undefined ? ev.which - 1 : null);

      // Does IE9 do this?
      if (self.isMSIE) {
        button = button === 1 ? 0 : button === 4 ? 1 : button;
      }

      if (button !== 2) return;

      self.element.contentEditable = 'true';
      setTimeout(function() {
        self.element.contentEditable = 'inherit'; // 'false';
      }, 1);
    }, true);
    
    // Listen for mouse events and translate
    // them into terminal mouse protocols.
    this.bindMouse();

    // Figure out whether boldness affects
    // the character width of monospace fonts.
    if (Terminal.brokenBold === undefined) {
      Terminal.brokenBold = isBoldBroken(this.document);
    }

    // this.emit('open');

    // This can be useful for pasting,
    // as well as the iPad fix.
    setTimeout(function() {
      self.element.focus();
    }, 100);
  };

  // XTerm mouse events
  // http://invisible-island.net/xterm/ctlseqs/ctlseqs.html#Mouse%20Tracking
  // To better understand these
  // the xterm code is very helpful:
  // Relevant files:
  //   button.c, charproc.c, misc.c
  // Relevant functions in xterm/button.c:
  //   BtnCode, EmitButtonCode, EditorButton, SendMousePosition
  bindMouse() {
    var el = this.element;
    var self = this;
    var pressed = 32;

    var wheelEvent = 'onmousewheel' in this.context ? 'mousewheel' : 'DOMMouseScroll';

    // mouseup, mousedown, mousewheel
    // left click: ^[[M 3<^[[M#3<
    // mousewheel up: ^[[M`3>
    function sendButton(ev) {
      var button;
      var pos;

      // get the xterm-style button
      button = getButton(ev);

      // get mouse coordinates
      pos = getCoords(ev);
      if (!pos) return;

      sendEvent(button, pos);

      switch (ev.type) {
        case 'mousedown':
          pressed = button;
          break;
        case 'mouseup':
          // keep it at the left
          // button, just in case.
          pressed = 32;
          break;
        case wheelEvent:
          // nothing. don't
          // interfere with
          // `pressed`.
          break;
      }
    }

    // motion example of a left click:
    // ^[[M 3<^[[M@4<^[[M@5<^[[M@6<^[[M@7<^[[M#7<
    function sendMove(ev) {
      var button = pressed;
      var pos;
  console.log("ev",ev);
      pos = getCoords(ev);
      if (!pos) return;

      // buttons marked as motions
      // are incremented by 32
      button += 32;

      sendEvent(button, pos);
    }

    // encode button and
    // position to characters
    function encode(data, ch) {
      if (!self.utfMouse) {
        if (ch === 255) return data.push(0);
        if (ch > 127) ch = 127;
        data.push(ch);
      } else {
        if (ch === 2047) return data.push(0);
        if (ch < 127) {
          data.push(ch);
        } else {
          if (ch > 2047) ch = 2047;
          data.push(0xC0 | (ch >> 6));
          data.push(0x80 | (ch & 0x3F));
        }
      }
    }

    // send a mouse event:
    // regular/utf8: ^[[M Cb Cx Cy
    // urxvt: ^[[ Cb ; Cx ; Cy M
    // sgr: ^[[ Cb ; Cx ; Cy M/m
    // vt300: ^[[ 24(1/3/5)~ [ Cx , Cy ] \r
    // locator: CSI P e ; P b ; P r ; P c ; P p & w
    function sendEvent(button, pos) {
      // self.emit('mouse', {
      //   x: pos.x - 32,
      //   y: pos.x - 32,
      //   button: button
      // });
      var data;
      
      if (self.vt300Mouse) {
        // NOTE: Unstable.
        // http://www.vt100.net/docs/vt3xx-gp/chapter15.html
        button &= 3;
        pos.x -= 32;
        pos.y -= 32;
        data = '\x1b[24';
        if (button === 0) data += '1';
        else if (button === 1) data += '3';
        else if (button === 2) data += '5';
        else if (button === 3) return;
        else data += '0';
        data += '~[' + pos.x + ',' + pos.y + ']\r';
        self.send(data);
        return;
      }

      if (self.decLocator) {
        // NOTE: Unstable.
        button &= 3;
        pos.x -= 32;
        pos.y -= 32;
        if (button === 0) button = 2;
        else if (button === 1) button = 4;
        else if (button === 2) button = 6;
        else if (button === 3) button = 3;
        self.send('\x1b[' +
                  button +
                  ';' +
                  (button === 3 ? 4 : 0) +
                  ';' +
                  pos.y +
                  ';' +
                  pos.x +
                  ';' +
                  (pos.page || 0) +
                  '&w');
        return;
      }

      if (self.urxvtMouse) {
        pos.x -= 32;
        pos.y -= 32;
        pos.x++;
        pos.y++;
        self.send('\x1b[' + button + ';' + pos.x + ';' + pos.y + 'M');
        return;
      }

      if (self.sgrMouse) {
        pos.x -= 32;
        pos.y -= 32;
        self.send('\x1b[<' +
                  ((button & 3) === 3 ? button & ~3 : button) +
                  ';' +
                  pos.x +
                  ';' +
                  pos.y +
                  ((button & 3) === 3 ? 'm' : 'M'));
        return;
      }

      data = [];

      encode(data, button);
      encode(data, pos.x);
      encode(data, pos.y);

      self.send('\x1b[M' + String.fromCharCode.apply(String, data));
    }

    function getButton(ev) {
      var button;
      var shift;
      var meta;
      var ctrl;
      var mod;

      // two low bits:
      // 0 = left
      // 1 = middle
      // 2 = right
      // 3 = release
      // wheel up/down:
      // 1, and 2 - with 64 added
      switch (ev.type) {
        case 'mousedown':
          button = ev.button !== undefined ? ev.button : (ev.which !== undefined ? ev.which - 1 : null);

          if (self.isMSIE) {
            button = button === 1 ? 0 : button === 4 ? 1 : button;
          }
          break;
        case 'mouseup':
          button = 3;
          break;
        case 'DOMMouseScroll':
          button = ev.detail < 0 ? 64 : 65;
          break;
        case 'mousewheel':
          button = ev.wheelDeltaY > 0 ? 64 : 65;
          break;
      }

      // next three bits are the modifiers:
      // 4 = shift, 8 = meta, 16 = control
      shift = ev.shiftKey ? 4 : 0;
      meta = ev.metaKey ? 8 : 0;
      ctrl = ev.ctrlKey ? 16 : 0;
      mod = shift | meta | ctrl;

      // no mods
      if (self.vt200Mouse) {
        // ctrl only
        mod &= ctrl;
      } else if (!self.normalMouse) {
        mod = 0;
      }

      // increment to SP
      button = (32 + (mod << 2)) + button;

      return button;
    }

    // mouse coordinates measured in cols/rows
    function getCoords(ev) {
      var x, col, row, w, el, target, rowElement;
      
      // ignore browsers without pageX for now
      if (ev.pageX === null) {
        return null;
      }

      // Identify the row DIV that was clicked.
      target = ev.target;
      rowElement = null;
      while (target !== self.element) {
        if (target.className === TERMINAL_ACTIVE_CLASS) {
          rowElement = target;
          break;
        }
        target = target.parentNode;
      }
      if (rowElement === null) {
        return null;
      }
      
      row = self.children.indexOf(rowElement) + 1;
      
      x = ev.pageX;
      el = rowElement;
      while (el && el !== self.document.documentElement) {
        x -= el.offsetLeft;
        el = 'offsetParent' in el ? el.offsetParent : el.parentNode;
      }

      // convert to cols
      w = rowElement.clientWidth;
      col = Math.floor((x / w) * self.cols) + 1;

      // be sure to avoid sending
      // bad positions to the program
      if (col < 0) col = 0;
      if (col > self.cols) col = self.cols;
      if (row < 0) row = 0;
      if (row > self.rows) row = self.rows;

      // xterm sends raw bytes and
      // starts at 32 (SP) for each.
      col += 32;  // FIXME don't do xterm's 32 offset here.
      row += 32;

      return {
        x: col,
        y: row,
        type: ev.type === wheelEvent ? 'mousewheel' : ev.type
      };
    }

    on(el, 'mousedown', function(ev) {
      if (!self.mouseEvents) return;

      // send the button
      sendButton(ev);

      // ensure focus
      self.focus();

      // fix for odd bug
      //if (self.vt200Mouse && !self.normalMouse) {
      if (self.vt200Mouse) {
        sendButton({ __proto__: ev, type: 'mouseup' });
        return cancel(ev);
      }

      // bind events
      if (self.normalMouse) on(self.document, 'mousemove', sendMove);

      // x10 compatibility mode can't send button releases
      if (!self.x10Mouse) {
        on(self.document, 'mouseup', function up(ev) {
          sendButton(ev);
          if (self.normalMouse) off(self.document, 'mousemove', sendMove);
          off(self.document, 'mouseup', up);
          return cancel(ev);
        });
      }

      return cancel(ev);
    });

    //if (self.normalMouse) {
    //  on(self.document, 'mousemove', sendMove);
    //}

    on(el, wheelEvent, function(ev) {
      if (!self.mouseEvents) return;
      if (self.x10Mouse || self.vt300Mouse || self.decLocator) return;
      sendButton(ev);
      return cancel(ev);
    });

    // allow mousewheel scrolling in
    // the shell for example
    on(el, wheelEvent, function(ev: MouseEvent) {
      if (self.mouseEvents) return;
      if (self.applicationKeypad) return;
      
      if (self.physicalScroll) {
        // Let the mouse whell scroll the DIV.
        var newScrollPosition;
        if ((<any>ev).wheelDelta > 0) {
            newScrollPosition = Math.max(0, self.element.scrollTop - self.charHeight * WHEELSCROLL_CHARS);
            self.element.scrollTop = newScrollPosition;
            self.emit('manual-scroll', { position: newScrollPosition, isBottom: self.isScrollAtBottom() });
        } else {
            newScrollPosition = Math.min(self.element.scrollHeight - self.element.clientHeight,
                                              self.element.scrollTop + self.charHeight * WHEELSCROLL_CHARS);
            self.element.scrollTop = newScrollPosition;
            self.emit('manual-scroll', { position: newScrollPosition, isBottom: self.isScrollAtBottom() });
        }
        return;
      }
      
      if (ev.type === 'DOMMouseScroll') {
        self.scrollDisp(ev.detail < 0 ? -5 : 5);
      } else {
        self.scrollDisp((<any>ev).wheelDeltaY > 0 ? -5 : 5);
      }
      return cancel(ev);
    });
  };

  /**
   * Destroy Terminal
   */

  destroy() {
    var style;  
    var doc = this.document;
    
    if (this._processWriteChunkTimer !== -1) {
      window.clearTimeout(this._processWriteChunkTimer);
      this._processWriteChunkTimer = -1;
    }
    
    if (this._refreshTimer !== -1) {
      window.clearTimeout(this._refreshTimer);
    }
    
    if (this.physicalScroll) {
      style = doc.getElementById('term-padding-style' + this._termId);
      style.remove();
    }
    this.readable = false;
    this.writable = false;
    this._events = {};
    this.handler = function() {};
    this.write = function() {};
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    //this.emit('close');
  };

  /**
   * Rendering Engine
   */

  /**
   * Schedule a screen refresh and update.
   * 
   * @param {boolean} immediate True if the refresh should occur as soon as possible. False if a slight delay is permitted.
   */
  _scheduleRefresh(immediate) {
    var self = this;
    var window = this.document.defaultView;
    if (this._refreshTimer === -1) {
      self._refreshTimer = window.setTimeout(function() {
        self._refreshTimer = -1;
        self._refreshFrame();
      }, immediate ? 0 : REFRESH_DELAY);
    }
  };

  /**
   * Refresh and update the screen.
   * 
   * Usually call via a timer.
   */
  _refreshFrame() {
    this.refresh(this.refreshStart, this.refreshEnd);
    this._refreshScrollback();
    this.refreshStart = REFRESH_START_NULL;
    this.refreshEnd = REFRESH_END_NULL;
  };

  // In the screen buffer, each character
  // is stored as a an array with a character
  // and a 32-bit integer.
  // First value: a utf-16 character.
  // Second value:
  // Next 9 bits: background color (0-511).
  // Next 9 bits: foreground color (0-511).
  // Next 14 bits: a mask for misc. flags:
  //   1=bold, 2=underline, 4=blink, 8=inverse, 16=invisible

  refresh(start, end) {
    var x;
    var y;
    var line;
    var row;
    if ( !this.physicalScroll && end >= this.lines.length) {
      this.log('`end` is too large. Most likely a bad CSR.');
      end = this.lines.length - 1;
    }

    for (y = start; y <= end; y++) {
      row = y + this.ydisp;
      line = this._getLine(row);

      // Place the cursor in the row.
      if (y === this.y &&
          this.cursorState &&
          (this.ydisp === this.ybase || this.selectMode) &&
          !this.cursorHidden &&
          this.x < this.cols) {

        x = this.x;
        line = line.slice();
        line[x] = [-1, line[x][1]];
      } else {
        x = -1;
      }

      this._getChildDiv(y).innerHTML = this._lineToHTML(line);
    }
  };
    
  /**
   * Render a line to a HTML string.
   * 
   * @param {Array} line Array describing a line of characters and attributes.
   * @returns {string} A HTML rendering of the line as a HTML string.
   */
  _lineToHTML(line) {
    var attr;
    var data;
    var ch;
    var i;
    var width;
    var out;
    var bg;
    var fg;
    var flags;
    
    attr = this.defAttr;
    width = line.length;
    out = '';
    
    for (i = 0; i < width; i++) {
      data = line[i][0];
      ch = line[i][1];

      if (data !== attr) {
        if (attr !== this.defAttr) {
          out += '</span>';
        }
        if (data !== this.defAttr) {
          if (data === -1) {
            out += '<span class="reverse-video terminal-cursor">';
          } else {
            out += '<span style="';

            bg = data & 0x1ff;
            fg = (data >> 9) & 0x1ff;
            flags = data >> 18;

            // bold
            if (flags & 1) {
              if (!Terminal.brokenBold) {
                out += 'font-weight:bold;';
              }
              // See: XTerm*boldColors
              if (fg < 8) fg += 8;
            }

            // underline
            if (flags & 2) {
              out += 'text-decoration:underline;';
            }

            // blink
            if (flags & 4) {
              if (flags & 2) {
                out = out.slice(0, -1);
                out += ' blink;';
              } else {
                out += 'text-decoration:blink;';
              }
            }

            // inverse
            if (flags & 8) {
              bg = (data >> 9) & 0x1ff;
              fg = data & 0x1ff;
              // Should inverse just be before the
              // above boldColors effect instead?
              if ((flags & 1) && fg < 8) fg += 8;
            }

            // invisible
            if (flags & 16) {
              out += 'visibility:hidden;';
            }

            if (bg !== 256) {
              out += 'background-color:' + this.colors[bg] + ';';
            }

            if (fg !== 257) {
              out += 'color:' + this.colors[fg] + ';';
            }

            out += '">';
          }
        }
      }

      switch (ch) {
        case '&':
          out += '&amp;';
          break;
        case '<':
          out += '&lt;';
          break;
        case '>':
          out += '&gt;';
          break;
        default:
          if (ch <= ' ') {
            out += '&nbsp;';
          } else {
            if (isWide(ch)) i++;
            out += ch;
          }
          break;
      }

      attr = data;
    }

    if (attr !== this.defAttr) {
      out += '</span>';
    }
    return out;
  };

  /**
   * Render any pending scrollback lines.
   */
  _refreshScrollback() {
    var frag;
    var i;
    var onScreenScrollback;
    var pendingScrollbackLength;
    var onScreenDelete;
    var div;
    var text;

    pendingScrollbackLength = this._scrollbackBuffer.length;
    if (pendingScrollbackLength !== 0) {

      onScreenScrollback = this.element.childNodes.length - this.children.length;
      
      if (pendingScrollbackLength > this.scrollback) {
        onScreenDelete = onScreenScrollback;  // Delete every scrollback row on screen.
        this._scrollbackBuffer.splice(0, pendingScrollbackLength - this.scrollback); // Truncate the TODO rows.
      } else {
        // Delete part of the on screen scrollback rows.
        onScreenDelete = Math.max(0, pendingScrollbackLength + onScreenScrollback - this.scrollback);
      }
      
      // Delete parts of the existing on screen scrollback.
      while (onScreenDelete !==0) {
        this.element.removeChild(this.element.childNodes[0]);
        onScreenDelete--;
      }
      
      pendingScrollbackLength = this._scrollbackBuffer.length;
    
      frag = this.document.createDocumentFragment();
      div = this.document.createElement('div');
      frag.appendChild(div);
      text = "";
      for (i = 0; i < pendingScrollbackLength; i++) {
        text += "<div class=\"terminal-scrollback\">";
        text += this._lineToHTML(this._scrollbackBuffer[i]);
        text += "</div>";
      }
      div.innerHTML = text;
      
      for (i = 0; i < pendingScrollbackLength; i++) {
        frag.appendChild(div.childNodes[0]);
      }
      div.remove();
      
      frag.appendChild(div);
      
      if (this.children.length === 0) {
        this.element.appendChild(frag);
      } else {
        this.element.insertBefore(frag, this.children[0]);
      }
      
      this._scrollbackBuffer = [];
    }
  };

  _cursorBlink() {
    if ( ! this.hasFocus) {
      return;
    }
    this.cursorState ^= 1;
    this.refresh(this.y, this.y);
  };

  showCursor() {
    if (!this.cursorState) {
      this.cursorState = 1;
      this.refresh(this.y, this.y);
    } else {
      // Temporarily disabled:
      // this.refreshBlink();
    }
  };

  /**
   * Set cursor blinking on or off.
   * 
   * @param {boolean} blink True if the cursor should blink.
   */
  setCursorBlink(blink) {
    if (this._blink !== null) {
      clearInterval(this._blink);
      this._blink = null;
    }
    this.cursorBlink = blink;
    
    if (this.element != null) {
      this.showCursor();
      this.startBlink();
    }
  };

  startBlink() {
    if (!this.cursorBlink) return;
    var self = this;
    this._blinker = function() {
      self._cursorBlink();
    };
    this._blink = setInterval(this._blinker, 500);
  };

  refreshBlink() {
    if (!this.cursorBlink) return;
    clearInterval(this._blink);
    this._blink = setInterval(this._blinker, 500);
  };

  scroll() {
    var row;
    var lastline;
    var oldline;

    if ( ! this.physicalScroll) {
      // Normal, virtual scrolling.
      ++this.ybase;
      // See if we have exceeded the scrollbar buffer length.
      if (this.ybase > this.scrollback) {
        // Drop the oldest line out of the scrollback buffer.
        this.ybase--;
        this.lines = this.lines.slice(-(this.ybase + this.rows) + 1);
      }
    } else {
      // Drop the oldest line out of the scrollback buffer.
      oldline = this.lines[0];
      this.lines = this.lines.slice(-(this.ybase + this.rows) + 1);
      this._scrollbackBuffer.push(oldline);
    }

    this.ydisp = this.ybase;

    // last line
    lastline = this.ybase + this.rows - 1;

    // subtract the bottom scroll region
    row = lastline - (this.rows - 1 - this.scrollBottom);

    // add our new line
    this.lines.splice(row, 0, this.blankLine());

    if (this.scrollTop !== 0) {
      if (this.ybase !== 0) {
        this.ybase--;
        this.ydisp = this.ybase;
      }
      this.lines.splice(this.ybase + this.scrollTop, 1);
    }

    // this.maxRange();
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
  };

  // Physical scroll to the bottom.
  scrollToBottom() {
    var newScrollPosition = this.element.scrollHeight - this.element.clientHeight;
    this.element.scrollTop = newScrollPosition;
    this.emit('manual-scroll', { position: newScrollPosition, isBottom: true });
  };

  isScrollAtBottom() {
    return this.element.scrollTop === this.element.scrollHeight - this.element.clientHeight;
  };

  scrollDisp(disp) {
    this.ydisp += disp;

    if (this.ydisp > this.ybase) {
      this.ydisp = this.ybase;
    } else if (this.ydisp < 0) {
      this.ydisp = 0;
    }

    this.refresh(0, this.rows - 1);
  };

  write(data) {
    this._writeBuffers.push(data);
    this._scheduleProcessWriteChunk();
  };

  /**
   * Schedule the write chunk process to run the next time the event loop is entered.
   */
  _scheduleProcessWriteChunk() {
    var self = this;
    var window = this.document.defaultView;
    if (this._processWriteChunkTimer === -1) {
      this._processWriteChunkTimer = window.setTimeout(function() {
        self._processWriteChunkTimer = -1;
        self._processWriteChunkRealTime();
      }, 0);
    }
  };

  /**
   * Process the next chunk of data to written into a the line array.
   */
  _processWriteChunkRealTime() {
    var starttime;
    var nowtime;
    
    starttime = window.performance.now();
  //console.log("++++++++ _processWriteChunk() start time: " + starttime);
    
    // Schedule a call back just in case. setTimeout(.., 0) still carries a ~4ms delay. 
    this._scheduleProcessWriteChunk();

    while (true) {
      if (this._processOneWriteChunk() === false) {
        window.clearTimeout(this._processWriteChunkTimer);
        this._processWriteChunkTimer = -1;
        
        this._scheduleRefresh(true);
        break;
      }
      
      nowtime = window.performance.now();
      if ((nowtime - starttime) > MAX_BATCH_TIME) {
        this._scheduleRefresh(false);
        break;
      }
    }
  //  console.log("---------- _processWriteChunk() end time: " + window.performance.now());
  };

  /**
   * Process one chunk of written data.
   * 
   * @returns {boolean} True if there are extra chunks available which need processing.
   */
  _processOneWriteChunk() {
    var chunk;
    
    if (this._writeBuffers.length === 0) {
      return false; // Nothing to do.
    }
    
    chunk = this._writeBuffers[0];
    if (chunk.length <= MAX_PROCESS_WRITE_SIZE) {
      this._writeBuffers.splice(0, 1);
    } else {
      this._writeBuffers[0] = chunk.slice(MAX_PROCESS_WRITE_SIZE);
      chunk = chunk.slice(0, MAX_PROCESS_WRITE_SIZE);
    }

    this._processWriteData(chunk);
    return this._writeBuffers.length !== 0;
  };

  _flushWriteBuffer() {
    while(this._processOneWriteChunk()) {
      // Keep on going until it is all done.
    }
  };

  _processWriteData(data) {
    var l = data.length;
    var i = 0;
    var j;
    var cs;
    var ch;
    var nextzero;
    var line;

  //console.log("write() data.length: " + data.length);
  //var starttime = window.performance.now();
  //var endtime;
  //console.log("write() start time: " + starttime);

    if (this.ybase !== this.ydisp) {
      this.ydisp = this.ybase;
      this.maxRange();
    }
    
    this.oldy = this.y;
    
    for (; i < l; i++) {
      ch = data[i];
      switch (this.state) {
        case normal:
          switch (ch) {
            // '\0'
            // case '\0':
            // case '\200':
            //   break;

            // '\a'
            case '\x07':
              this.bell();
              break;

            // '\n', '\v', '\f'
            case '\n':
            case '\x0b':
            case '\x0c':
              if (this.convertEol) {
                this.x = 0;
              }
              // TODO: Implement eat_newline_glitch.
              // if (this.realX >= this.cols) break;
              // this.realX = 0;
              this.y++;
              if (this.y > this.scrollBottom) {
                this.y--;
                this.scroll();
              }
              break;

            // '\r'
            case '\r':
              this.x = 0;
              break;

            // '\b'
            case '\x08':
              if (this.x > 0) {
                this.x--;
              }
              break;

            // '\t'
            case '\t':
              this.x = this.nextStop();
              break;

            // shift out
            case '\x0e':
              this.setgLevel(1);
              break;

            // shift in
            case '\x0f':
              this.setgLevel(0);
              break;

            // '\e'
            case '\x1b':
              this.state = escaped;
              break;

            default:
              // ' '
              if (ch >= ' ') {
                if (this.charset && this.charset[ch]) {
                  ch = this.charset[ch];
                }

                if (this.x >= this.cols) {
                  this.x = 0;
                  this.updateRange(this.y);
                  this.y++;
                  if (this.y > this.scrollBottom) {
                    this.y--;
                    this.scroll();
                  }
                }

                line = this._getLine(this.y + this.ybase);
                
                if (this.insertMode) {
                  // Push the characters out of the way to make space.
                  line.splice(this.x, 0, [this.curAttr, ' ']);
                  if (isWide(ch)) {
                    line.splice(this.x, 0, [this.curAttr, ' ']);
                  }
                  line.splice(this.cols, line.length-this.cols);
                }

                line[this.x] = [this.curAttr, ch];
                this.x++;
                this.updateRange(this.y);

                if (isWide(ch)) {
                  j = this.y + this.ybase;
                  if (this.cols < 2 || this.x >= this.cols) {
                    this._getLine(j)[this.x - 1] = [this.curAttr, ' '];
                    break;
                  }
                  this._getLine(j)[this.x] = [this.curAttr, ' '];
                  this.x++;
                }
              }
              break;
          }
          break;

        case escaped:
          switch (ch) {
            // ESC [ Control Sequence Introducer ( CSI is 0x9b).
            case '[':
              this.params = [];
              this.currentParam = 0;
              this.state = csi;
              break;

            // ESC ] Operating System Command ( OSC is 0x9d).
            case ']':
              this.params = [];
              this.currentParam = 0;
              this.state = osc;
              break;
              
            // ESC & Application mode
            case '&':
              this.params = [];
              this.currentParam = "";
              this.state = application_start;
              break;
              
            // ESC P Device Control String ( DCS is 0x90).
            case 'P':
              this.params = [];
              this.currentParam = 0;
              this.state = dcs;
              break;

            // ESC _ Application Program Command ( APC is 0x9f).
            case '_':
              this.state = ignore;
              break;

            // ESC ^ Privacy Message ( PM is 0x9e).
            case '^':
              this.state = ignore;
              break;

            // ESC c Full Reset (RIS).
            case 'c':
              this.reset();
              break;

            // ESC E Next Line ( NEL is 0x85).
            case 'E':
              this.x = 0;
              this.index();
              break;

            // ESC D Index ( IND is 0x84).
            case 'D':
              this.index();
              break;

            // ESC M Reverse Index ( RI is 0x8d).
            case 'M':
              this.reverseIndex();
              break;

            // ESC % Select default/utf-8 character set.
            // @ = default, G = utf-8
            case '%':
              //this.charset = null;
              this.setgLevel(0);
              this.setgCharset(0, Terminal.charsets.US);
              this.state = normal;
              i++;
              break;

            // ESC (,),*,+,-,. Designate G0-G2 Character Set.
            case '(': // <-- this seems to get all the attention
            case ')':
            case '*':
            case '+':
            case '-':
            case '.':
              switch (ch) {
                case '(':
                  this.gcharset = 0;
                  break;
                case ')':
                  this.gcharset = 1;
                  break;
                case '*':
                  this.gcharset = 2;
                  break;
                case '+':
                  this.gcharset = 3;
                  break;
                case '-':
                  this.gcharset = 1;
                  break;
                case '.':
                  this.gcharset = 2;
                  break;
              }
              this.state = charset;
              break;

            // Designate G3 Character Set (VT300).
            // A = ISO Latin-1 Supplemental.
            // Not implemented.
            case '/':
              this.gcharset = 3;
              this.state = charset;
              i--;
              break;

            // ESC N
            // Single Shift Select of G2 Character Set
            // ( SS2 is 0x8e). This affects next character only.
            case 'N':
              break;
            // ESC O
            // Single Shift Select of G3 Character Set
            // ( SS3 is 0x8f). This affects next character only.
            case 'O':
              break;
            // ESC n
            // Invoke the G2 Character Set as GL (LS2).
            case 'n':
              this.setgLevel(2);
              break;
            // ESC o
            // Invoke the G3 Character Set as GL (LS3).
            case 'o':
              this.setgLevel(3);
              break;
            // ESC |
            // Invoke the G3 Character Set as GR (LS3R).
            case '|':
              this.setgLevel(3);
              break;
            // ESC }
            // Invoke the G2 Character Set as GR (LS2R).
            case '}':
              this.setgLevel(2);
              break;
            // ESC ~
            // Invoke the G1 Character Set as GR (LS1R).
            case '~':
              this.setgLevel(1);
              break;

            // ESC 7 Save Cursor (DECSC).
            case '7':
              this.saveCursor();
              this.state = normal;
              break;

            // ESC 8 Restore Cursor (DECRC).
            case '8':
              this.restoreCursor();
              this.state = normal;
              break;

            // ESC # 3 DEC line height/width
            case '#':
              this.state = normal;
              i++;
              break;

            // ESC H Tab Set (HTS is 0x88).
            case 'H':
              this.tabSet();
              break;

            // ESC = Application Keypad (DECPAM).
            case '=':
              this.log('Serial port requested application keypad.');
              this.applicationKeypad = true;
              this.state = normal;
              break;

            // ESC > Normal Keypad (DECPNM).
            case '>':
              this.log('Switching back to normal keypad.');
              this.applicationKeypad = false;
              this.state = normal;
              break;
              
            default:
              this.state = normal;
              this.error('Unknown ESC control: %s.', ch);
              break;
          }
          break;

        case charset:
          switch (ch) {
            case '0': // DEC Special Character and Line Drawing Set.
              cs = Terminal.charsets.SCLD;
              break;
            case 'A': // UK
              cs = Terminal.charsets.UK;
              break;
            case 'B': // United States (USASCII).
              cs = Terminal.charsets.US;
              break;
            case '4': // Dutch
              cs = Terminal.charsets.Dutch;
              break;
            case 'C': // Finnish
            case '5':
              cs = Terminal.charsets.Finnish;
              break;
            case 'R': // French
              cs = Terminal.charsets.French;
              break;
            case 'Q': // FrenchCanadian
              cs = Terminal.charsets.FrenchCanadian;
              break;
            case 'K': // German
              cs = Terminal.charsets.German;
              break;
            case 'Y': // Italian
              cs = Terminal.charsets.Italian;
              break;
            case 'E': // NorwegianDanish
            case '6':
              cs = Terminal.charsets.NorwegianDanish;
              break;
            case 'Z': // Spanish
              cs = Terminal.charsets.Spanish;
              break;
            case 'H': // Swedish
            case '7':
              cs = Terminal.charsets.Swedish;
              break;
            case '=': // Swiss
              cs = Terminal.charsets.Swiss;
              break;
            case '/': // ISOLatin (actually /A)
              cs = Terminal.charsets.ISOLatin;
              i++;
              break;
            default: // Default
              cs = Terminal.charsets.US;
              break;
          }
          this.setgCharset(this.gcharset, cs);
          this.gcharset = null;
          this.state = normal;
          break;

        case osc:
          // OSC Ps ; Pt ST
          // OSC Ps ; Pt BEL
          //   Set Text Parameters.
          if (ch === '\x1b' || ch === '\x07') {
            if (ch === '\x1b') i++;

            this.params.push(this.currentParam);

            switch (this.params[0]) {
              case 0:
              case 1:
              case 2:
                if (this.params[1]) {
                  this.title = this.params[1];
                  this.handleTitle(this.title);
                }
                break;
              case 3:
                // set X property
                break;
              case 4:
              case 5:
                // change dynamic colors
                break;
              case 10:
              case 11:
              case 12:
              case 13:
              case 14:
              case 15:
              case 16:
              case 17:
              case 18:
              case 19:
                // change dynamic ui colors
                break;
              case 46:
                // change log file
                break;
              case 50:
                // dynamic font
                break;
              case 51:
                // emacs shell
                break;
              case 52:
                // manipulate selection data
                break;
              case 104:
              case 105:
              case 110:
              case 111:
              case 112:
              case 113:
              case 114:
              case 115:
              case 116:
              case 117:
              case 118:
                // reset colors
                break;
            }

            this.params = [];
            this.currentParam = 0;
            this.state = normal;
          } else {
            if (!this.params.length) {
              if (ch >= '0' && ch <= '9') {
                this.currentParam =
                  (<number> this.currentParam) * 10 + ch.charCodeAt(0) - 48;
              } else if (ch === ';') {
                this.params.push(this.currentParam);
                this.currentParam = '';
              }
            } else {
              this.currentParam += ch;
            }
          }
          break;

        case csi:
          // '?', '>', '!'
          if (ch === '?' || ch === '>' || ch === '!') {
            this.prefix = ch;
            break;
          }

          // 0 - 9
          if (ch >= '0' && ch <= '9') {
            this.currentParam = (<number> this.currentParam) * 10 + ch.charCodeAt(0) - 48;
            break;
          }

          // '$', '"', ' ', '\''
          if (ch === '$' || ch === '"' || ch === ' ' || ch === '\'') {
            this.postfix = ch;
            break;
          }

          this.params.push(this.currentParam);
          this.currentParam = 0;

          // ';'
          if (ch === ';') break;

          this.state = normal;

          switch (ch) {
            // CSI Ps A
            // Cursor Up Ps Times (default = 1) (CUU).
            case 'A':
              this.cursorUp(this.params);
              break;

            // CSI Ps B
            // Cursor Down Ps Times (default = 1) (CUD).
            case 'B':
              this.cursorDown(this.params);
              break;

            // CSI Ps C
            // Cursor Forward Ps Times (default = 1) (CUF).
            case 'C':
              this.cursorForward(this.params);
              break;

            // CSI Ps D
            // Cursor Backward Ps Times (default = 1) (CUB).
            case 'D':
              this.cursorBackward(this.params);
              break;

            // CSI Ps ; Ps H
            // Cursor Position [row;column] (default = [1,1]) (CUP).
            case 'H':
              this.cursorPos(this.params);
              break;

            // CSI Ps J  Erase in Display (ED).
            case 'J':
              this.eraseInDisplay(this.params);
              break;

            // CSI Ps K  Erase in Line (EL).
            case 'K':
              this.eraseInLine(this.params);
              break;

            // CSI Pm m  Character Attributes (SGR).
            case 'm':
              if (!this.prefix) {
                this.charAttributes(this.params);
              }
              break;

            // CSI Ps n  Device Status Report (DSR).
            case 'n':
              if (!this.prefix) {
                this.deviceStatus(this.params);
              }
              break;

            /**
             * Additions
             */

            // CSI Ps @
            // Insert Ps (Blank) Character(s) (default = 1) (ICH).
            case '@':
              this.insertChars(this.params);
              break;

            // CSI Ps E
            // Cursor Next Line Ps Times (default = 1) (CNL).
            case 'E':
              this.cursorNextLine(this.params);
              break;

            // CSI Ps F
            // Cursor Preceding Line Ps Times (default = 1) (CNL).
            case 'F':
              this.cursorPrecedingLine(this.params);
              break;

            // CSI Ps G
            // Cursor Character Absolute  [column] (default = [row,1]) (CHA).
            case 'G':
              this.cursorCharAbsolute(this.params);
              break;

            // CSI Ps L
            // Insert Ps Line(s) (default = 1) (IL).
            case 'L':
              this.insertLines(this.params);
              break;

            // CSI Ps M
            // Delete Ps Line(s) (default = 1) (DL).
            case 'M':
              this.deleteLines(this.params);
              break;

            // CSI Ps P
            // Delete Ps Character(s) (default = 1) (DCH).
            case 'P':
              this.deleteChars(this.params);
              break;

            // CSI Ps X
            // Erase Ps Character(s) (default = 1) (ECH).
            case 'X':
              this.eraseChars(this.params);
              break;

            // CSI Pm `  Character Position Absolute
            //   [column] (default = [row,1]) (HPA).
            case '`':
              this.charPosAbsolute(this.params);
              break;

            // 141 61 a * HPR -
            // Horizontal Position Relative
            case 'a':
              this.HPositionRelative(this.params);
              break;

            // CSI P s c
            // Send Device Attributes (Primary DA).
            // CSI > P s c
            // Send Device Attributes (Secondary DA)
            case 'c':
              this.sendDeviceAttributes(this.params);
              break;

            // CSI Pm d
            // Line Position Absolute  [row] (default = [1,column]) (VPA).
            case 'd':
              this.linePosAbsolute(this.params);
              break;

            // 145 65 e * VPR - Vertical Position Relative
            case 'e':
              this.VPositionRelative(this.params);
              break;

            // CSI Ps ; Ps f
            //   Horizontal and Vertical Position [row;column] (default =
            //   [1,1]) (HVP).
            case 'f':
              this.HVPosition(this.params);
              break;

            // CSI Pm h  Set Mode (SM).
            // CSI ? Pm h - mouse escape codes, cursor escape codes
            case 'h':
              this.setMode(this.params);
              break;

            // CSI Pm l  Reset Mode (RM).
            // CSI ? Pm l
            case 'l':
              this.resetMode(this.params);
              break;

            // CSI Ps ; Ps r
            //   Set Scrolling Region [top;bottom] (default = full size of win-
            //   dow) (DECSTBM).
            // CSI ? Pm r
            case 'r':
              this.setScrollRegion(this.params);
              break;

            // CSI s
            //   Save cursor (ANSI.SYS).
            case 's':
              this.saveCursor();
              break;

            // CSI u
            //   Restore cursor (ANSI.SYS).
            case 'u':
              this.restoreCursor();
              break;

            /**
             * Lesser Used
             */

            // CSI Ps I
            // Cursor Forward Tabulation Ps tab stops (default = 1) (CHT).
            case 'I':
              this.cursorForwardTab(this.params);
              break;

            // CSI Ps S  Scroll up Ps lines (default = 1) (SU).
            case 'S':
              this.scrollUp(this.params);
              break;

            // CSI Ps T  Scroll down Ps lines (default = 1) (SD).
            // CSI Ps ; Ps ; Ps ; Ps ; Ps T
            // CSI > Ps; Ps T
            case 'T':
              // if (this.prefix === '>') {
              //   this.resetTitleModes(this.params);
              //   break;
              // }
              // if (this.params.length > 2) {
              //   this.initMouseTracking(this.params);
              //   break;
              // }
              if (this.params.length < 2 && !this.prefix) {
                this.scrollDown(this.params);
              }
              break;

            // CSI Ps Z
            // Cursor Backward Tabulation Ps tab stops (default = 1) (CBT).
            case 'Z':
              this.cursorBackwardTab(this.params);
              break;

            // CSI Ps b  Repeat the preceding graphic character Ps times (REP).
            case 'b':
              this.repeatPrecedingCharacter(this.params);
              break;

            // CSI Ps g  Tab Clear (TBC).
            case 'g':
              this.tabClear(this.params);
              break;

            // CSI Pm i  Media Copy (MC).
            // CSI ? Pm i
            // case 'i':
            //   this.mediaCopy(this.params);
            //   break;

            // CSI Pm m  Character Attributes (SGR).
            // CSI > Ps; Ps m
            // case 'm': // duplicate
            //   if (this.prefix === '>') {
            //     this.setResources(this.params);
            //   } else {
            //     this.charAttributes(this.params);
            //   }
            //   break;

            // CSI Ps n  Device Status Report (DSR).
            // CSI > Ps n
            // case 'n': // duplicate
            //   if (this.prefix === '>') {
            //     this.disableModifiers(this.params);
            //   } else {
            //     this.deviceStatus(this.params);
            //   }
            //   break;

            // CSI > Ps p  Set pointer mode.
            // CSI ! p   Soft terminal reset (DECSTR).
            // CSI Ps$ p
            //   Request ANSI mode (DECRQM).
            // CSI ? Ps$ p
            //   Request DEC private mode (DECRQM).
            // CSI Ps ; Ps " p
            case 'p':
              switch (this.prefix) {
                // case '>':
                //   this.setPointerMode(this.params);
                //   break;
                case '!':
                  this.softReset(this.params);
                  break;
                // case '?':
                //   if (this.postfix === '$') {
                //     this.requestPrivateMode(this.params);
                //   }
                //   break;
                // default:
                //   if (this.postfix === '"') {
                //     this.setConformanceLevel(this.params);
                //   } else if (this.postfix === '$') {
                //     this.requestAnsiMode(this.params);
                //   }
                //   break;
              }
              break;

            // CSI Ps q  Load LEDs (DECLL).
            // CSI Ps SP q
            // CSI Ps " q
            // case 'q':
            //   if (this.postfix === ' ') {
            //     this.setCursorStyle(this.params);
            //     break;
            //   }
            //   if (this.postfix === '"') {
            //     this.setCharProtectionAttr(this.params);
            //     break;
            //   }
            //   this.loadLEDs(this.params);
            //   break;

            // CSI Ps ; Ps r
            //   Set Scrolling Region [top;bottom] (default = full size of win-
            //   dow) (DECSTBM).
            // CSI ? Pm r
            // CSI Pt; Pl; Pb; Pr; Ps$ r
            // case 'r': // duplicate
            //   if (this.prefix === '?') {
            //     this.restorePrivateValues(this.params);
            //   } else if (this.postfix === '$') {
            //     this.setAttrInRectangle(this.params);
            //   } else {
            //     this.setScrollRegion(this.params);
            //   }
            //   break;

            // CSI s     Save cursor (ANSI.SYS).
            // CSI ? Pm s
            // case 's': // duplicate
            //   if (this.prefix === '?') {
            //     this.savePrivateValues(this.params);
            //   } else {
            //     this.saveCursor(this.params);
            //   }
            //   break;

            // CSI Ps ; Ps ; Ps t
            // CSI Pt; Pl; Pb; Pr; Ps$ t
            // CSI > Ps; Ps t
            // CSI Ps SP t
            // case 't':
            //   if (this.postfix === '$') {
            //     this.reverseAttrInRectangle(this.params);
            //   } else if (this.postfix === ' ') {
            //     this.setWarningBellVolume(this.params);
            //   } else {
            //     if (this.prefix === '>') {
            //       this.setTitleModeFeature(this.params);
            //     } else {
            //       this.manipulateWindow(this.params);
            //     }
            //   }
            //   break;

            // CSI u     Restore cursor (ANSI.SYS).
            // CSI Ps SP u
            // case 'u': // duplicate
            //   if (this.postfix === ' ') {
            //     this.setMarginBellVolume(this.params);
            //   } else {
            //     this.restoreCursor(this.params);
            //   }
            //   break;

            // CSI Pt; Pl; Pb; Pr; Pp; Pt; Pl; Pp$ v
            // case 'v':
            //   if (this.postfix === '$') {
            //     this.copyRectagle(this.params);
            //   }
            //   break;

            // CSI Pt ; Pl ; Pb ; Pr ' w
            // case 'w':
            //   if (this.postfix === '\'') {
            //     this.enableFilterRectangle(this.params);
            //   }
            //   break;

            // CSI Ps x  Request Terminal Parameters (DECREQTPARM).
            // CSI Ps x  Select Attribute Change Extent (DECSACE).
            // CSI Pc; Pt; Pl; Pb; Pr$ x
            // case 'x':
            //   if (this.postfix === '$') {
            //     this.fillRectangle(this.params);
            //   } else {
            //     this.requestParameters(this.params);
            //     //this.__(this.params);
            //   }
            //   break;

            // CSI Ps ; Pu ' z
            // CSI Pt; Pl; Pb; Pr$ z
            // case 'z':
            //   if (this.postfix === '\'') {
            //     this.enableLocatorReporting(this.params);
            //   } else if (this.postfix === '$') {
            //     this.eraseRectangle(this.params);
            //   }
            //   break;

            // CSI Pm ' {
            // CSI Pt; Pl; Pb; Pr$ {
            // case '{':
            //   if (this.postfix === '\'') {
            //     this.setLocatorEvents(this.params);
            //   } else if (this.postfix === '$') {
            //     this.selectiveEraseRectangle(this.params);
            //   }
            //   break;

            // CSI Ps ' |
            // case '|':
            //   if (this.postfix === '\'') {
            //     this.requestLocatorPosition(this.params);
            //   }
            //   break;

            // CSI P m SP }
            // Insert P s Column(s) (default = 1) (DECIC), VT420 and up.
            // case '}':
            //   if (this.postfix === ' ') {
            //     this.insertColumns(this.params);
            //   }
            //   break;

            // CSI P m SP ~
            // Delete P s Column(s) (default = 1) (DECDC), VT420 and up
            // case '~':
            //   if (this.postfix === ' ') {
            //     this.deleteColumns(this.params);
            //   }
            //   break;

            default:
              this.error('Unknown CSI code: %s.', ch);
              break;
          }

          this.prefix = '';
          this.postfix = '';
          break;

        case dcs:
          if (ch === '\x1b' || ch === '\x07') {
            if (ch === '\x1b') i++;

            switch (this.prefix) {
              // User-Defined Keys (DECUDK).
              case '':
                break;

              // Request Status String (DECRQSS).
              // test: echo -e '\eP$q"p\e\\'
              case '$q':
                var pt = this.currentParam;
                var valid = false;
                let replyPt = "";
                
                switch (pt) {
                  // DECSCA
                  case '"q':
                    replyPt = '0"q';
                    break;

                  // DECSCL
                  case '"p':
                    replyPt = '61"p';
                    break;

                  // DECSTBM
                  case 'r':
                    replyPt = '' +
                      (this.scrollTop + 1) +
                      ';' +
                      (this.scrollBottom + 1) +
                      'r';
                    break;

                  // SGR
                  case 'm':
                    replyPt = '0m';
                    break;

                  default:
                    this.error('Unknown DCS Pt: %s.', "" + pt);
                    replyPt = '';
                    break;
                }

                this.send('\x1bP' + (valid ? 1 : 0) + '$r' + replyPt + '\x1b\\');
                break;

              // Set Termcap/Terminfo Data (xterm, experimental).
              case '+p':
                break;

              // Request Termcap/Terminfo String (xterm, experimental)
              // Regular xterm does not even respond to this sequence.
              // This can cause a small glitch in vim.
              // test: echo -ne '\eP+q6b64\e\\'
              case '+q':
                pt = this.currentParam;
                valid = false;

                this.send('\x1bP' + (valid ? 1 : 0) + '+r' + pt + '\x1b\\');
                break;

              default:
                this.error('Unknown DCS prefix: %s.', this.prefix);
                break;
            }

            this.currentParam = 0;
            this.prefix = '';
            this.state = normal;
          } else if (!this.currentParam) {
            if (!this.prefix && ch !== '$' && ch !== '+') {
              this.currentParam = ch;
            } else if (this.prefix.length === 2) {
              this.currentParam = ch;
            } else {
              this.prefix += ch;
            }
          } else {
            this.currentParam += ch;
          }
          break;

        case ignore:
          // For PM and APC.
          if (ch === '\x1b' || ch === '\x07') {
            if (ch === '\x1b') i++;
            this.state = normal;
          }
          break;
          
        case application_start:
          if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) {
            // Add to the current parameter.
            this.currentParam += ch;  // FIXME don't absorb infinite data here.
            
          } else if (ch === ';') {
            // Parameter separator.
            this.params.push(this.currentParam);
            this.currentParam = '';
            
          } else if (ch === '\x07') {
            // End of parameters.
            this.params.push(this.currentParam);
            if (this.params[0] === this.applicationModeCookie) {
              this.state = application;
              this.emit('application-mode-start', this.params);
            } else {
              this.log("Invalid application mode cookie.");
              this.state = normal;
            }
          } else {
            // Invalid application start.
            this.state = normal;
            this.log("Invalid application mode start command.");
          }
          break;
          
        case application:
          // Efficiently look for an end-mode character.
          nextzero = data.indexOf('\x00', i);
          if (nextzero === -1) {
            // Send all of the data on right now.
            this.emit('application-mode-data', data.slice(i));
            i = l-1;
            
          } else if (nextzero === i) {
            // We are already at the end-mode character.
            this.emit('application-mode-end');
            this.state = normal;
            
          } else {
            // Incoming end-mode character. Send the last piece of data.
            this.emit('application-mode-data', data.slice(i, nextzero));
            i = nextzero - 1;
          }
          break;
      }
      
      if (this.y !== this.oldy) {
        this.updateRange(this.oldy);
        this.updateRange(this.y);
        this.oldy = this.y;
      }
    }

    this.updateRange(this.y);
      
  //  endtime = window.performance.now();
  //console.log("write() end time: " + endtime);
  //  console.log("duration: " + (endtime - starttime) + "ms");
  };

  writeln(data) {
    this.write(data + '\r\n');
  };

  // Key Resources:
  // https://developer.mozilla.org/en-US/docs/DOM/KeyboardEvent
  keyDown(ev) {
    var self = this;
    var key = null;
    var newScrollPosition;
    
    switch (ev.keyCode) {
      // backspace
      case 8:
        if (ev.shiftKey) {
          key = '\x08'; // ^H
          break;
        }
        key = '\x7f'; // ^?
        break;
      // tab
      case 9:
        if (ev.shiftKey) {
          key = '\x1b[Z';
          break;
        }
        key = '\t';
        break;
      // return/enter
      case 13:
        key = '\r';
        break;
      // escape
      case 27:
        key = '\x1b';
        break;
      // left-arrow
      case 37:
        if (ev.shiftKey) {
          break;
        }
        if (ev.ctrlKey) {
          key = "\x1b[1;5D";
          break;
        }
        if (this.applicationCursor) {
          key = '\x1bOD'; // SS3 as ^[O for 7-bit
          //key = '\x8fD'; // SS3 as 0x8f for 8-bit
          break;
        }
        key = '\x1b[D';
        break;
      // right-arrow
      case 39:
        if (ev.shiftKey) {
          break;
        }
        if (ev.ctrlKey) {
          key = "\x1b[1;5C";
          break;
        }
        if (this.applicationCursor) {
          key = '\x1bOC';
          break;
        }
        key = '\x1b[C';
        break;
      // up-arrow
      case 38:
        if (this.applicationCursor) {
          key = '\x1bOA';
          break;
        }
        if (ev.ctrlKey) {
          if (ev.shiftKey) {
            this.scrollDisp(-1);
            return cancel(ev);
          } else {
            key = "\x1b[1;5A";
          }
        } else {
          key = '\x1b[A';
        }
        break;
      // down-arrow
      case 40:
        if (this.applicationCursor) {
          key = '\x1bOB';
          break;
        }
        if (ev.ctrlKey) {
          if (ev.shiftKey) {
            this.scrollDisp(1);
            return cancel(ev);
          } else {
            key = "\x1b[1;5B";
          }
        } else {
          key = '\x1b[B';
        }
        break;
      // delete
      case 46:
        key = '\x1b[3~';
        break;
      // insert
      case 45:
        key = '\x1b[2~';
        break;
      // home
      case 36:
        if (this.applicationKeypad) {
          key = '\x1bOH';
          break;
        }
        key = '\x1bOH';
        break;
      // end
      case 35:
        if (this.applicationKeypad) {
          key = '\x1bOF';
          break;
        }
        key = '\x1bOF';
        break;
      // page up
      case 33:
        if (ev.shiftKey) {
          if ( !this.physicalScroll) {
            // Virtual scroll up.
            this.scrollDisp(-(this.rows - 1));
          } else {
            // Scroll using the DOM.
            newScrollPosition = Math.max(0, this.element.scrollTop - (this.element.clientHeight / 2));
            this.element.scrollTop = newScrollPosition;
            this.emit('manual-scroll', { position: newScrollPosition, isBottom: this.isScrollAtBottom() });
          }
          return cancel(ev);
        } else {
          key = '\x1b[5~';
        }
        break;
      // page down
      case 34:
        if (ev.shiftKey) {
          if ( !this.physicalScroll) {
            // Virtual scroll down.
            this.scrollDisp(this.rows - 1);
          } else {
            // Scroll using the DOM.
            newScrollPosition = Math.min(this.element.scrollHeight - this.element.clientHeight,
                                              this.element.scrollTop + (this.element.clientHeight / 2));
            this.element.scrollTop = newScrollPosition;
            this.emit('manual-scroll', { position: newScrollPosition, isBottom: this.isScrollAtBottom() });
          }
          return cancel(ev);
        } else {
          key = '\x1b[6~';
        }
        break;
      // F1
      case 112:
        key = '\x1bOP';
        break;
      // F2
      case 113:
        key = '\x1bOQ';
        break;
      // F3
      case 114:
        key = '\x1bOR';
        break;
      // F4
      case 115:
        key = '\x1bOS';
        break;
      // F5
      case 116:
        key = '\x1b[15~';
        break;
      // F6
      case 117:
        key = '\x1b[17~';
        break;
      // F7
      case 118:
        key = '\x1b[18~';
        break;
      // F8
      case 119:
        key = '\x1b[19~';
        break;
      // F9
      case 120:
        key = '\x1b[20~';
        break;
      // F10
      case 121:
        key = '\x1b[21~';
        break;
      // F11
      case 122:
        key = '\x1b[23~';
        break;
      // F12
      case 123:
        key = '\x1b[24~';
        break;
        
      default:
        // a-z and space
        if (ev.ctrlKey) {
          if (ev.shiftKey) {
            // Ctrl+Shift
            
            if (ev.keyCode === 189) {
              // Ctrl+Shift+_ key
              key = '\x1f';
            }
            
          } else {
            // Ctrl, no shift.
            if (ev.keyCode >= 65 && ev.keyCode <= 90) {
              // Ctrl-A
              if (this.screenKeys) {
                if (!this.prefixMode && !this.selectMode && ev.keyCode === 65) {
                  this.enterPrefix();
                  return cancel(ev);
                }
              }
              // Ctrl-V
              if (this.prefixMode && ev.keyCode === 86) {
                this.leavePrefix();
                return;
              }
              // Ctrl-C
              if ((this.prefixMode || this.selectMode) && ev.keyCode === 67) {
                if (this.visualMode) {
                  setTimeout(function() {
                    self.leaveVisual();
                  }, 1);
                }
                return;
              }
              key = String.fromCharCode(ev.keyCode - 64);
            } else if (ev.keyCode === 32) {
              // NUL
              key = String.fromCharCode(0);
            } else if (ev.keyCode >= 51 && ev.keyCode <= 55) {
              // escape, file sep, group sep, record sep, unit sep
              key = String.fromCharCode(ev.keyCode - 51 + 27);
            } else if (ev.keyCode === 56) {
              // delete
              key = String.fromCharCode(127);
            } else if (ev.keyCode === 219) {
              // ^[ - escape
              key = String.fromCharCode(27);
            } else if (ev.keyCode === 221) {
              // ^] - group sep
              key = String.fromCharCode(29);
            }
          }        
          break;

        } else if ((!this.isMac && ev.altKey) || (this.isMac && ev.metaKey)) {
          if (ev.keyCode >= 65 && ev.keyCode <= 90) {
            key = '\x1b' + String.fromCharCode(ev.keyCode + 32);
          } else if (ev.keyCode === 192) {
            key = '\x1b`';
          } else if (ev.keyCode >= 48 && ev.keyCode <= 57) {
            key = '\x1b' + (ev.keyCode - 48);
          }
        } else {
          return true;
        }
        break;
    }

    if (key === null) {
      this.emit('unknown-keydown', ev);
      return cancel(ev);
    }

    if (this.prefixMode) {
      this.leavePrefix();
      return cancel(ev);
    }

    if (this.selectMode) {
      this.keySelect(ev, key);
      return cancel(ev);
    }

    this.emit('keydown', ev);
    this.emit('key', key, ev);

    this.showCursor();
    this.handler(key);

    return cancel(ev);
  }

  setgLevel(g) {
    this.glevel = g;
    this.charset = this.charsets[g];
  }

  setgCharset(g, charset) {
    this.charsets[g] = charset;
    if (this.glevel === g) {
      this.charset = charset;
    }
  }

  keyPress(ev) {
    var key;

    cancel(ev);

    if (ev.charCode) {
      key = ev.charCode;
    } else if (ev.which === undefined) {
      key = ev.keyCode;
    } else if (ev.which !== 0 && ev.charCode !== 0) {
      key = ev.which;
    } else {
      return false;
    }

    if (!key || ev.ctrlKey || ev.altKey || ev.metaKey) return false;

    key = String.fromCharCode(key);

    if (this.prefixMode) {
      this.leavePrefix();
      this.keyPrefix(ev, key);
      return false;
    }

    if (this.selectMode) {
      this.keySelect(ev, key);
      return false;
    }

    this.emit('keypress', key, ev);
    this.emit('key', key, ev);

    this.showCursor();
    this.handler(key);

    return false;
  };

  send(data) {
    var self = this;

    if (!this.queue) {
      setTimeout(function() {
        self.handler(self.queue);
        self.queue = '';
      }, 1);
    }

    this.queue += data;
  };

  bell() {
    this.emit('bell');
    if (!this.visualBell) return;
    var self = this;
    this.element.style.borderColor = 'white';
    setTimeout(function() {
      self.element.style.borderColor = '';
    }, 10);
    if (this.popOnBell) this.focus();
  }

  log(...args: string[]): void {
    if (!this.debug) return;
    if (!this.context.console || !this.context.console.log) return;
    this.context.console.log.apply(this.context.console, args);
  };

  error(...args: string[]): void {
    if (!this.debug) return;
    if (!this.context.console || !this.context.console.error) return;
    this.context.console.error.apply(this.context.console, args);
  };

  resize(newcols, newrows) {
    var line;
    var el;
    var i;
    var j;
    var ch;

    newcols = Math.max(newcols, 1);
    newrows = Math.max(newrows, 1);

    // resize cols
    if (this.cols < newcols) {
      // Add chars to the lines to match the new (bigger) cols value.
      ch = [this.defAttr, ' ']; // does xterm use the default attr?
      for (i = this.lines.length-1; i >= 0; i--) {
        line = this.lines[i];
        while (line.length < newcols) {
          line.push(ch);
        }
      }
    } else if (this.cols > newcols) {
      // Remove chars from the lines to match the new (smaller) cols value.
      for (i = this.lines.length-1; i >= 0; i--) {
        line = this.lines[i];
        while (line.length > newcols) {
          line.pop();
        }
      }
    }
    this.setupStops(this.cols);
    this.cols = newcols;

    // resize rows
    if (this.rows < newrows) {
      // Add new rows to match the new bigger rows value.
      if ( !this.physicalScroll) {
        el = this.element;
        for (j = this.rows; j < newrows; j++) {
          if (this.lines.length < newrows + this.ybase) {
            this.lines.push(this.blankLine());
          }
          if (this.children.length < newrows) {
            line = this.document.createElement('div');
            el.appendChild(line);
            this.children.push(line);
          }
        }
      }
    } else if (this.rows > newrows) {
      // Remove rows to match the new smaller rows value.
      while (this.lines.length > newrows + this.ybase) {
        this.lines.pop();
      }
      
      while (this.children.length > newrows) {
        el = this.children.pop();
        el.parentNode.removeChild(el);
      }
    }
    this.rows = newrows;

    // make sure the cursor stays on screen
    if (this.y >= newrows) {
      this.y = newrows - 1;
    }
    if (this.x >= newcols) {
      this.x = newcols - 1;
    }

    this.scrollTop = 0;
    this.scrollBottom = newrows - 1;
    
    this.refresh(0, this.physicalScroll ? this.lines.length-1 : this.rows - 1);

    // it's a real nightmare trying
    // to resize the original
    // screen buffer. just set it
    // to null for now.
    this.normal = null;
  };

  /**
   * Resize the terminal to fill its containing element.
   * 
   * @returns Object with the new colums (cols field) and rows (rows field) information.
   */
  resizeToContainer() {
    var rect;
    var charWidth;
    var charHeight;
    var newCols;
    var newRows;
    var range;
    var lineEl = this.children[0];
    var computedStyle;
    var width;
    
    range = this.document.createRange();
    range.setStart(lineEl, 0);
    range.setEnd(lineEl, lineEl.childNodes.length);
    
    rect = range.getBoundingClientRect();
    
    charWidth = rect.width / this.cols;
    charHeight = rect.height;
      
    this.charHeight = charHeight;
    
    function px(value) {
      if (value === null || value === undefined || value === "") {
        return 0;
      }
      return parseInt(value.slice(0,-2),10);
    }  
    computedStyle = window.getComputedStyle(lineEl);
    width = this.element.clientWidth - px(computedStyle.marginLeft) - px(computedStyle.marginRight);
    
    newCols = Math.floor(width / charWidth);
    newRows = Math.floor(this.element.clientHeight / charHeight);

    this.resize(newCols, newRows);
    this._setLastLinePadding(Math.floor(this.element.clientHeight % charHeight));
    return {cols: newCols, rows: newRows};
  };

  updateRange(y) {
    if (y < this.refreshStart) this.refreshStart = y;
    if (y > this.refreshEnd) this.refreshEnd = y;
    // if (y > this.refreshEnd) {
    //   this.refreshEnd = y;
    //   if (y > this.rows - 1) {
    //     this.refreshEnd = this.rows - 1;
    //   }
    // }
  };

  maxRange() {
    this.refreshStart = 0;
    this.refreshEnd = this.rows - 1;
  };

  setupStops(i?: number): void {
    if (i !== undefined && i !== null) {
      if (!this.tabs[i]) {
        i = this.prevStop(i);
      }
    } else {
      this.tabs = {};
      i = 0;
    }

    for (; i < this.cols; i += 8) {
      this.tabs[i] = true;
    }
  };

  prevStop(x?) {
    if (x === undefined) x = this.x;
    while (!this.tabs[--x] && x > 0);
    return x >= this.cols ? this.cols - 1 : (x < 0 ? 0 : x);
  };

  nextStop(x?) {
    if (x === undefined) x = this.x;
    while (!this.tabs[++x] && x < this.cols);
    return x >= this.cols ? this.cols - 1 : (x < 0 ? 0 : x);
  };

  eraseRight(x, y) {
    var line = this._getLine(this.ybase + y);
    var ch = [this.eraseAttr(), ' ']; // xterm

    for (; x < this.cols; x++) {
      line[x] = ch;
    }

    this.updateRange(y);
  }

  eraseLeft(x, y) {
    var line = this._getLine(this.ybase + y);
    var ch = [this.eraseAttr(), ' ']; // xterm

    x++;
    while (x !== 0) {
      x--;
      line[x] = ch;
    }

    this.updateRange(y);
  }

  eraseLine(y) {
    this.eraseRight(0, y);
  }

  blankLine(cur?) {
    var attr = cur ? this.eraseAttr() : this.defAttr;

    var ch = [attr, ' '];
    var line = [];
    var i = 0;

    for (; i < this.cols; i++) {
      line[i] = ch;
    }

    return line;
  }

  ch(cur) {
    return cur ? [this.eraseAttr(), ' '] : [this.defAttr, ' '];
  }

  is(term) {
    var name = this.termName;
    return (name + '').indexOf(term) === 0;
  }

  handler(data) {
    this.emit('data', data);
  }

  handleTitle(title) {
    this.emit('title', title);
  }

  /**
   * ESC
   */

  // ESC D Index (IND is 0x84).
  index() {
    this.y++;
    if (this.y > this.scrollBottom) {
      this.y--;
      this.scroll();
    }
    this.state = normal;
  }

  // ESC M Reverse Index (RI is 0x8d).
  reverseIndex() {
    var j;
    this.y--;
    if (this.y < this.scrollTop) {
      this.y++;
      // possibly move the code below to term.reverseScroll();
      // test: echo -ne '\e[1;1H\e[44m\eM\e[0m'
      // blankLine(true) is xterm/linux behavior
      this.lines.splice(this.y + this.ybase, 0, this.blankLine(true));
      j = this.rows - 1 - this.scrollBottom;
      this.lines.splice(this.rows - 1 + this.ybase - j + 1, 1);
      // this.maxRange();
      this.updateRange(this.scrollTop);
      this.updateRange(this.scrollBottom);
    }
    this.state = normal;
  };

  // ESC c Full Reset (RIS).
  reset() {
    this._resetVariables();
    this.refresh(0, this.rows - 1);
  };

  // ESC H Tab Set (HTS is 0x88).
  tabSet() {
    this.tabs[this.x] = true;
    this.state = normal;
  };

  /**
   * CSI
   */

  // CSI Ps A
  // Cursor Up Ps Times (default = 1) (CUU).
  cursorUp(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.y -= param;
    if (this.y < 0) this.y = 0;
  };

  // CSI Ps B
  // Cursor Down Ps Times (default = 1) (CUD).
  cursorDown(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.y += param;
    if (this.y >= this.rows) {
      this.y = this.rows - 1;
    }
  };

  // CSI Ps C
  // Cursor Forward Ps Times (default = 1) (CUF).
  cursorForward(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.x += param;
    if (this.x >= this.cols) {
      this.x = this.cols - 1;
    }
  };

  // CSI Ps D
  // Cursor Backward Ps Times (default = 1) (CUB).
  cursorBackward(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.x -= param;
    if (this.x < 0) this.x = 0;
  };

  // CSI Ps ; Ps H
  // Cursor Position [row;column] (default = [1,1]) (CUP).
  cursorPos(params) {
    var row, col;

    row = params[0] - 1;

    if (params.length >= 2) {
      col = params[1] - 1;
    } else {
      col = 0;
    }

    if (row < 0) {
      row = 0;
    } else if (row >= this.rows) {
      row = this.rows - 1;
    }

    if (col < 0) {
      col = 0;
    } else if (col >= this.cols) {
      col = this.cols - 1;
    }

    this.x = col;
    this.y = row;
  };

  // CSI Ps J  Erase in Display (ED).
  //     Ps = 0  -> Erase Below (default).
  //     Ps = 1  -> Erase Above.
  //     Ps = 2  -> Erase All.
  //     Ps = 3  -> Erase Saved Lines (xterm).
  // CSI ? Ps J
  //   Erase in Display (DECSED).
  //     Ps = 0  -> Selective Erase Below (default).
  //     Ps = 1  -> Selective Erase Above.
  //     Ps = 2  -> Selective Erase All.
  eraseInDisplay(params) {
    var j;
    switch (params[0]) {
      case 0:
        this.eraseRight(this.x, this.y);
        j = this.y + 1;
        for (; j < this.rows; j++) {
          this.eraseLine(j);
        }
        break;
      case 1:
        this.eraseLeft(this.x, this.y);
        j = this.y;
        while (j--) {
          this.eraseLine(j);
        }
        break;
      case 2:
        j = this.rows;
        while (j--) this.eraseLine(j);
        break;
      case 3:
        // no saved lines
        break;
    }
  };

  // CSI Ps K  Erase in Line (EL).
  //     Ps = 0  -> Erase to Right (default).
  //     Ps = 1  -> Erase to Left.
  //     Ps = 2  -> Erase All.
  // CSI ? Ps K
  //   Erase in Line (DECSEL).
  //     Ps = 0  -> Selective Erase to Right (default).
  //     Ps = 1  -> Selective Erase to Left.
  //     Ps = 2  -> Selective Erase All.
  eraseInLine(params) {
    switch (params[0]) {
      case 0:
        this.eraseRight(this.x, this.y);
        break;
      case 1:
        this.eraseLeft(this.x, this.y);
        break;
      case 2:
        this.eraseLine(this.y);
        break;
    }
  };

  // CSI Pm m  Character Attributes (SGR).
  //     Ps = 0  -> Normal (default).
  //     Ps = 1  -> Bold.
  //     Ps = 4  -> Underlined.
  //     Ps = 5  -> Blink (appears as Bold).
  //     Ps = 7  -> Inverse.
  //     Ps = 8  -> Invisible, i.e., hidden (VT300).
  //     Ps = 2 2  -> Normal (neither bold nor faint).
  //     Ps = 2 4  -> Not underlined.
  //     Ps = 2 5  -> Steady (not blinking).
  //     Ps = 2 7  -> Positive (not inverse).
  //     Ps = 2 8  -> Visible, i.e., not hidden (VT300).
  //     Ps = 3 0  -> Set foreground color to Black.
  //     Ps = 3 1  -> Set foreground color to Red.
  //     Ps = 3 2  -> Set foreground color to Green.
  //     Ps = 3 3  -> Set foreground color to Yellow.
  //     Ps = 3 4  -> Set foreground color to Blue.
  //     Ps = 3 5  -> Set foreground color to Magenta.
  //     Ps = 3 6  -> Set foreground color to Cyan.
  //     Ps = 3 7  -> Set foreground color to White.
  //     Ps = 3 9  -> Set foreground color to default (original).
  //     Ps = 4 0  -> Set background color to Black.
  //     Ps = 4 1  -> Set background color to Red.
  //     Ps = 4 2  -> Set background color to Green.
  //     Ps = 4 3  -> Set background color to Yellow.
  //     Ps = 4 4  -> Set background color to Blue.
  //     Ps = 4 5  -> Set background color to Magenta.
  //     Ps = 4 6  -> Set background color to Cyan.
  //     Ps = 4 7  -> Set background color to White.
  //     Ps = 4 9  -> Set background color to default (original).

  //   If 16-color support is compiled, the following apply.  Assume
  //   that xterm's resources are set so that the ISO color codes are
  //   the first 8 of a set of 16.  Then the aixterm colors are the
  //   bright versions of the ISO colors:
  //     Ps = 9 0  -> Set foreground color to Black.
  //     Ps = 9 1  -> Set foreground color to Red.
  //     Ps = 9 2  -> Set foreground color to Green.
  //     Ps = 9 3  -> Set foreground color to Yellow.
  //     Ps = 9 4  -> Set foreground color to Blue.
  //     Ps = 9 5  -> Set foreground color to Magenta.
  //     Ps = 9 6  -> Set foreground color to Cyan.
  //     Ps = 9 7  -> Set foreground color to White.
  //     Ps = 1 0 0  -> Set background color to Black.
  //     Ps = 1 0 1  -> Set background color to Red.
  //     Ps = 1 0 2  -> Set background color to Green.
  //     Ps = 1 0 3  -> Set background color to Yellow.
  //     Ps = 1 0 4  -> Set background color to Blue.
  //     Ps = 1 0 5  -> Set background color to Magenta.
  //     Ps = 1 0 6  -> Set background color to Cyan.
  //     Ps = 1 0 7  -> Set background color to White.

  //   If xterm is compiled with the 16-color support disabled, it
  //   supports the following, from rxvt:
  //     Ps = 1 0 0  -> Set foreground and background color to
  //     default.

  //   If 88- or 256-color support is compiled, the following apply.
  //     Ps = 3 8  ; 5  ; Ps -> Set foreground color to the second
  //     Ps.
  //     Ps = 4 8  ; 5  ; Ps -> Set background color to the second
  //     Ps.
  charAttributes(params) {
    // Optimize a single SGR0.
    if (params.length === 1 && params[0] === 0) {
      this.curAttr = this.defAttr;
      return;
    }

    var l = params.length;
    var i = 0;
    var flags = this.curAttr >> 18;
    var fg = (this.curAttr >> 9) & 0x1ff;
    var bg = this.curAttr & 0x1ff;
    var p;

    for (; i < l; i++) {
      p = params[i];
      if (p >= 30 && p <= 37) {
        // fg color 8
        fg = p - 30;
      } else if (p >= 40 && p <= 47) {
        // bg color 8
        bg = p - 40;
      } else if (p >= 90 && p <= 97) {
        // fg color 16
        p += 8;
        fg = p - 90;
      } else if (p >= 100 && p <= 107) {
        // bg color 16
        p += 8;
        bg = p - 100;
      } else if (p === 0) {
        // default
        flags = this.defAttr >> 18;
        fg = (this.defAttr >> 9) & 0x1ff;
        bg = this.defAttr & 0x1ff;
        // flags = 0;
        // fg = 0x1ff;
        // bg = 0x1ff;
      } else if (p === 1) {
        // bold text
        flags |= 1;
      } else if (p === 4) {
        // underlined text
        flags |= 2;
      } else if (p === 5) {
        // blink
        flags |= 4;
      } else if (p === 7) {
        // inverse and positive
        // test with: echo -e '\e[31m\e[42mhello\e[7mworld\e[27mhi\e[m'
        flags |= 8;
      } else if (p === 8) {
        // invisible
        flags |= 16;
      } else if (p === 22) {
        // not bold
        flags &= ~1;
      } else if (p === 24) {
        // not underlined
        flags &= ~2;
      } else if (p === 25) {
        // not blink
        flags &= ~4;
      } else if (p === 27) {
        // not inverse
        flags &= ~8;
      } else if (p === 28) {
        // not invisible
        flags &= ~16;
      } else if (p === 39) {
        // reset fg
        fg = (this.defAttr >> 9) & 0x1ff;
      } else if (p === 49) {
        // reset bg
        bg = this.defAttr & 0x1ff;
      } else if (p === 38) {
        // fg color 256
        if (params[i + 1] === 2) {
          i += 2;
          fg = matchColor(
            params[i] & 0xff,
            params[i + 1] & 0xff,
            params[i + 2] & 0xff);
          if (fg === -1) fg = 0x1ff;
          i += 2;
        } else if (params[i + 1] === 5) {
          i += 2;
          p = params[i] & 0xff;
          fg = p;
        }
      } else if (p === 48) {
        // bg color 256
        if (params[i + 1] === 2) {
          i += 2;
          bg = matchColor(
            params[i] & 0xff,
            params[i + 1] & 0xff,
            params[i + 2] & 0xff);
          if (bg === -1) bg = 0x1ff;
          i += 2;
        } else if (params[i + 1] === 5) {
          i += 2;
          p = params[i] & 0xff;
          bg = p;
        }
      } else if (p === 100) {
        // reset fg/bg
        fg = (this.defAttr >> 9) & 0x1ff;
        bg = this.defAttr & 0x1ff;
      } else {
        this.error('Unknown SGR attribute: %d.', p);
      }
    }

    this.curAttr = (flags << 18) | (fg << 9) | bg;
  };

  // CSI Ps n  Device Status Report (DSR).
  //     Ps = 5  -> Status Report.  Result (``OK'') is
  //   CSI 0 n
  //     Ps = 6  -> Report Cursor Position (CPR) [row;column].
  //   Result is
  //   CSI r ; c R
  // CSI ? Ps n
  //   Device Status Report (DSR, DEC-specific).
  //     Ps = 6  -> Report Cursor Position (CPR) [row;column] as CSI
  //     ? r ; c R (assumes page is zero).
  //     Ps = 1 5  -> Report Printer status as CSI ? 1 0  n  (ready).
  //     or CSI ? 1 1  n  (not ready).
  //     Ps = 2 5  -> Report UDK status as CSI ? 2 0  n  (unlocked)
  //     or CSI ? 2 1  n  (locked).
  //     Ps = 2 6  -> Report Keyboard status as
  //   CSI ? 2 7  ;  1  ;  0  ;  0  n  (North American).
  //   The last two parameters apply to VT400 & up, and denote key-
  //   board ready and LK01 respectively.
  //     Ps = 5 3  -> Report Locator status as
  //   CSI ? 5 3  n  Locator available, if compiled-in, or
  //   CSI ? 5 0  n  No Locator, if not.
  deviceStatus(params) {
    if (!this.prefix) {
      switch (params[0]) {
        case 5:
          // status report
          this.send('\x1b[0n');
          break;
        case 6:
          // cursor position
          this.send('\x1b[' + (this.y + 1) + ';' + (this.x + 1) + 'R');
          break;
      }
    } else if (this.prefix === '?') {
      // modern xterm doesnt seem to
      // respond to any of these except ?6, 6, and 5
      switch (params[0]) {
        case 6:
          // cursor position
          this.send('\x1b[?' + (this.y + 1) + ';' + (this.x + 1) + 'R');
          break;
        case 15:
          // no printer
          // this.send('\x1b[?11n');
          break;
        case 25:
          // dont support user defined keys
          // this.send('\x1b[?21n');
          break;
        case 26:
          // north american keyboard
          // this.send('\x1b[?27;1;0;0n');
          break;
        case 53:
          // no dec locator/mouse
          // this.send('\x1b[?50n');
          break;
      }
    }
  };

  /**
   * Additions
   */

  // CSI Ps @
  // Insert Ps (Blank) Character(s) (default = 1) (ICH).
  insertChars(params) {
    var param, row, j, ch, line;

    param = params[0];
    if (param < 1) param = 1;

    row = this.y + this.ybase;
    j = this.x;
    ch = [this.eraseAttr(), ' ']; // xterm

    while (param-- && j < this.cols) {
      line = this._getLine(row);
      line.splice(j++, 0, ch);
      line.pop();
    }
  };

  // CSI Ps E
  // Cursor Next Line Ps Times (default = 1) (CNL).
  // same as CSI Ps B ?
  cursorNextLine(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.y += param;
    if (this.y >= this.rows) {
      this.y = this.rows - 1;
    }
    this.x = 0;
  };

  // CSI Ps F
  // Cursor Preceding Line Ps Times (default = 1) (CNL).
  // reuse CSI Ps A ?
  cursorPrecedingLine(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.y -= param;
    if (this.y < 0) this.y = 0;
    this.x = 0;
  };

  // CSI Ps G
  // Cursor Character Absolute  [column] (default = [row,1]) (CHA).
  cursorCharAbsolute(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.x = param - 1;
  };

  // CSI Ps L
  // Insert Ps Line(s) (default = 1) (IL).
  insertLines(params) {
    var param, row, j;

    param = params[0];
    if (param < 1) param = 1;
    row = this.y + this.ybase;

    j = this.rows - 1 - this.scrollBottom;
    j = this.rows - 1 + this.ybase - j + 1;

    while (param--) {
      // test: echo -e '\e[44m\e[1L\e[0m'
      // blankLine(true) - xterm/linux behavior
      this._getLine(row);
      this.lines.splice(row, 0, this.blankLine(true));
      this.lines.splice(j, 1);
    }

    // this.maxRange();
    this.updateRange(this.y);
    this.updateRange(this.scrollBottom);
  };

  // CSI Ps M
  // Delete Ps Line(s) (default = 1) (DL).
  deleteLines(params) {
    var param, row, j;

    param = params[0];
    if (param < 1) param = 1;
    row = this.y + this.ybase;

    j = this.rows - 1 - this.scrollBottom;
    j = this.rows - 1 + this.ybase - j;

    while (param--) {
      // test: echo -e '\e[44m\e[1M\e[0m'
      // blankLine(true) - xterm/linux behavior
      this._getLine(j + 1);
      this.lines.splice(j + 1, 0, this.blankLine(true));
      this.lines.splice(row, 1);
    }

    // this.maxRange();
    this.updateRange(this.y);
    this.updateRange(this.scrollBottom);
  };

  // CSI Ps P
  // Delete Ps Character(s) (default = 1) (DCH).
  deleteChars(params) {
    var param, row, ch, line;

    param = params[0];
    if (param < 1) param = 1;

    row = this.y + this.ybase;
    ch = [this.eraseAttr(), ' ']; // xterm

    while (param--) {
      line = this.lines[row];
      line.splice(this.x, 1);
      line.push(ch);
    }
  };

  // CSI Ps X
  // Erase Ps Character(s) (default = 1) (ECH).
  eraseChars(params) {
    var param, row, j, ch, line;

    param = params[0];
    if (param < 1) param = 1;

    row = this.y + this.ybase;
    j = this.x;
    ch = [this.eraseAttr(), ' ']; // xterm
    line = this._getLine(row);
    
    while (param-- && j < this.cols) {
      line[j] = ch;
      j++;
    }
  };

  // CSI Pm `  Character Position Absolute
  //   [column] (default = [row,1]) (HPA).
  charPosAbsolute(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.x = param - 1;
    if (this.x >= this.cols) {
      this.x = this.cols - 1;
    }
  };

  // 141 61 a * HPR -
  // Horizontal Position Relative
  // reuse CSI Ps C ?
  HPositionRelative(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.x += param;
    if (this.x >= this.cols) {
      this.x = this.cols - 1;
    }
  };

  // CSI Ps c  Send Device Attributes (Primary DA).
  //     Ps = 0  or omitted -> request attributes from terminal.  The
  //     response depends on the decTerminalID resource setting.
  //     -> CSI ? 1 ; 2 c  (``VT100 with Advanced Video Option'')
  //     -> CSI ? 1 ; 0 c  (``VT101 with No Options'')
  //     -> CSI ? 6 c  (``VT102'')
  //     -> CSI ? 6 0 ; 1 ; 2 ; 6 ; 8 ; 9 ; 1 5 ; c  (``VT220'')
  //   The VT100-style response parameters do not mean anything by
  //   themselves.  VT220 parameters do, telling the host what fea-
  //   tures the terminal supports:
  //     Ps = 1  -> 132-columns.
  //     Ps = 2  -> Printer.
  //     Ps = 6  -> Selective erase.
  //     Ps = 8  -> User-defined keys.
  //     Ps = 9  -> National replacement character sets.
  //     Ps = 1 5  -> Technical characters.
  //     Ps = 2 2  -> ANSI color, e.g., VT525.
  //     Ps = 2 9  -> ANSI text locator (i.e., DEC Locator mode).
  // CSI > Ps c
  //   Send Device Attributes (Secondary DA).
  //     Ps = 0  or omitted -> request the terminal's identification
  //     code.  The response depends on the decTerminalID resource set-
  //     ting.  It should apply only to VT220 and up, but xterm extends
  //     this to VT100.
  //     -> CSI  > Pp ; Pv ; Pc c
  //   where Pp denotes the terminal type
  //     Pp = 0  -> ``VT100''.
  //     Pp = 1  -> ``VT220''.
  //   and Pv is the firmware version (for xterm, this was originally
  //   the XFree86 patch number, starting with 95).  In a DEC termi-
  //   nal, Pc indicates the ROM cartridge registration number and is
  //   always zero.
  // More information:
  //   xterm/charproc.c - line 2012, for more information.
  //   vim responds with ^[[?0c or ^[[?1c after the terminal's response (?)
  sendDeviceAttributes(params) {
    if (params[0] > 0) return;

    if (!this.prefix) {
      if (this.is('xterm') || this.is('rxvt-unicode') || this.is('screen')) {
        this.send('\x1b[?1;2c');
      } else if (this.is('linux')) {
        this.send('\x1b[?6c');
      }
    } else if (this.prefix === '>') {
      // xterm and urxvt
      // seem to spit this
      // out around ~370 times (?).
      if (this.is('xterm')) {
        this.send('\x1b[>0;276;0c');
      } else if (this.is('rxvt-unicode')) {
        this.send('\x1b[>85;95;0c');
      } else if (this.is('linux')) {
        // not supported by linux console.
        // linux console echoes parameters.
        this.send(params[0] + 'c');
      } else if (this.is('screen')) {
        this.send('\x1b[>83;40003;0c');
      }
    }
  };

  // CSI Pm d
  // Line Position Absolute  [row] (default = [1,column]) (VPA).
  linePosAbsolute(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.y = param - 1;
    if (this.y >= this.rows) {
      this.y = this.rows - 1;
    }
  };

  // 145 65 e * VPR - Vertical Position Relative
  // reuse CSI Ps B ?
  VPositionRelative(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.y += param;
    if (this.y >= this.rows) {
      this.y = this.rows - 1;
    }
  };

  // CSI Ps ; Ps f
  //   Horizontal and Vertical Position [row;column] (default =
  //   [1,1]) (HVP).
  HVPosition(params) {
    if (params[0] < 1) params[0] = 1;
    if (params[1] < 1) params[1] = 1;

    this.y = params[0] - 1;
    if (this.y >= this.rows) {
      this.y = this.rows - 1;
    }

    this.x = params[1] - 1;
    if (this.x >= this.cols) {
      this.x = this.cols - 1;
    }
  };

  // CSI Pm h  Set Mode (SM).
  //     Ps = 2  -> Keyboard Action Mode (AM).
  //     Ps = 4  -> Insert Mode (IRM).
  //     Ps = 1 2  -> Send/receive (SRM).
  //     Ps = 2 0  -> Automatic Newline (LNM).
  // CSI ? Pm h
  //   DEC Private Mode Set (DECSET).
  //     Ps = 1  -> Application Cursor Keys (DECCKM).
  //     Ps = 2  -> Designate USASCII for character sets G0-G3
  //     (DECANM), and set VT100 mode.
  //     Ps = 3  -> 132 Column Mode (DECCOLM).
  //     Ps = 4  -> Smooth (Slow) Scroll (DECSCLM).
  //     Ps = 5  -> Reverse Video (DECSCNM).
  //     Ps = 6  -> Origin Mode (DECOM).
  //     Ps = 7  -> Wraparound Mode (DECAWM).
  //     Ps = 8  -> Auto-repeat Keys (DECARM).
  //     Ps = 9  -> Send Mouse X & Y on button press.  See the sec-
  //     tion Mouse Tracking.
  //     Ps = 1 0  -> Show toolbar (rxvt).
  //     Ps = 1 2  -> Start Blinking Cursor (att610).
  //     Ps = 1 8  -> Print form feed (DECPFF).
  //     Ps = 1 9  -> Set print extent to full screen (DECPEX).
  //     Ps = 2 5  -> Show Cursor (DECTCEM).
  //     Ps = 3 0  -> Show scrollbar (rxvt).
  //     Ps = 3 5  -> Enable font-shifting functions (rxvt).
  //     Ps = 3 8  -> Enter Tektronix Mode (DECTEK).
  //     Ps = 4 0  -> Allow 80 -> 132 Mode.
  //     Ps = 4 1  -> more(1) fix (see curses resource).
  //     Ps = 4 2  -> Enable Nation Replacement Character sets (DECN-
  //     RCM).
  //     Ps = 4 4  -> Turn On Margin Bell.
  //     Ps = 4 5  -> Reverse-wraparound Mode.
  //     Ps = 4 6  -> Start Logging.  This is normally disabled by a
  //     compile-time option.
  //     Ps = 4 7  -> Use Alternate Screen Buffer.  (This may be dis-
  //     abled by the titeInhibit resource).
  //     Ps = 6 6  -> Application keypad (DECNKM).
  //     Ps = 6 7  -> Backarrow key sends backspace (DECBKM).
  //     Ps = 1 0 0 0  -> Send Mouse X & Y on button press and
  //     release.  See the section Mouse Tracking.
  //     Ps = 1 0 0 1  -> Use Hilite Mouse Tracking.
  //     Ps = 1 0 0 2  -> Use Cell Motion Mouse Tracking.
  //     Ps = 1 0 0 3  -> Use All Motion Mouse Tracking.
  //     Ps = 1 0 0 4  -> Send FocusIn/FocusOut events.
  //     Ps = 1 0 0 5  -> Enable Extended Mouse Mode.
  //     Ps = 1 0 1 0  -> Scroll to bottom on tty output (rxvt).
  //     Ps = 1 0 1 1  -> Scroll to bottom on key press (rxvt).
  //     Ps = 1 0 3 4  -> Interpret "meta" key, sets eighth bit.
  //     (enables the eightBitInput resource).
  //     Ps = 1 0 3 5  -> Enable special modifiers for Alt and Num-
  //     Lock keys.  (This enables the numLock resource).
  //     Ps = 1 0 3 6  -> Send ESC   when Meta modifies a key.  (This
  //     enables the metaSendsEscape resource).
  //     Ps = 1 0 3 7  -> Send DEL from the editing-keypad Delete
  //     key.
  //     Ps = 1 0 3 9  -> Send ESC  when Alt modifies a key.  (This
  //     enables the altSendsEscape resource).
  //     Ps = 1 0 4 0  -> Keep selection even if not highlighted.
  //     (This enables the keepSelection resource).
  //     Ps = 1 0 4 1  -> Use the CLIPBOARD selection.  (This enables
  //     the selectToClipboard resource).
  //     Ps = 1 0 4 2  -> Enable Urgency window manager hint when
  //     Control-G is received.  (This enables the bellIsUrgent
  //     resource).
  //     Ps = 1 0 4 3  -> Enable raising of the window when Control-G
  //     is received.  (enables the popOnBell resource).
  //     Ps = 1 0 4 7  -> Use Alternate Screen Buffer.  (This may be
  //     disabled by the titeInhibit resource).
  //     Ps = 1 0 4 8  -> Save cursor as in DECSC.  (This may be dis-
  //     abled by the titeInhibit resource).
  //     Ps = 1 0 4 9  -> Save cursor as in DECSC and use Alternate
  //     Screen Buffer, clearing it first.  (This may be disabled by
  //     the titeInhibit resource).  This combines the effects of the 1
  //     0 4 7  and 1 0 4 8  modes.  Use this with terminfo-based
  //     applications rather than the 4 7  mode.
  //     Ps = 1 0 5 0  -> Set terminfo/termcap function-key mode.
  //     Ps = 1 0 5 1  -> Set Sun function-key mode.
  //     Ps = 1 0 5 2  -> Set HP function-key mode.
  //     Ps = 1 0 5 3  -> Set SCO function-key mode.
  //     Ps = 1 0 6 0  -> Set legacy keyboard emulation (X11R6).
  //     Ps = 1 0 6 1  -> Set VT220 keyboard emulation.
  //     Ps = 2 0 0 4  -> Set bracketed paste mode.
  // Modes:
  //   http://vt100.net/docs/vt220-rm/chapter4.html
  setMode(params) {
    if (typeof params === 'object') {
      var l = params.length;
      var i = 0;

      for (; i < l; i++) {
        this.setMode(params[i]);
      }

      return;
    }

    if (!this.prefix) {
      switch (params) {
        case 4:
          this.insertMode = true;
          break;
        case 20:
          //this.convertEol = true;
          break;
      }
    } else if (this.prefix === '?') {
      switch (params) {
        case 1:
          this.applicationCursor = true;
          break;
        case 2:
          this.setgCharset(0, Terminal.charsets.US);
          this.setgCharset(1, Terminal.charsets.US);
          this.setgCharset(2, Terminal.charsets.US);
          this.setgCharset(3, Terminal.charsets.US);
          // set VT100 mode here
          break;
        case 3: // 132 col mode
          this.savedCols = this.cols;
          this.resize(132, this.rows);
          break;
        case 6:
          this.originMode = true;
          break;
        case 7:
          this.wraparoundMode = true;
          break;
        case 12:
          // this.cursorBlink = true;
          break;
        case 66:
          this.log('Serial port requested application keypad.');
          this.applicationKeypad = true;
          break;
        case 9: // X10 Mouse
          // no release, no motion, no wheel, no modifiers.
        case 1000: // vt200 mouse
          // no motion.
          // no modifiers, except control on the wheel.
        case 1002: // button event mouse
        case 1003: // any event mouse
          // any event - sends motion events,
          // even if there is no button held down.
          this.x10Mouse = params === 9;
          this.vt200Mouse = params === 1000;
          this.normalMouse = params > 1000;
          this.mouseEvents = true;
          this.element.style.cursor = 'default';
          this.log('Binding to mouse events.');
          break;
        case 1004: // send focusin/focusout events
          // focusin: ^[[I
          // focusout: ^[[O
          this.sendFocus = true;
          break;
        case 1005: // utf8 ext mode mouse
          this.utfMouse = true;
          // for wide terminals
          // simply encodes large values as utf8 characters
          break;
        case 1006: // sgr ext mode mouse
          this.sgrMouse = true;
          // for wide terminals
          // does not add 32 to fields
          // press: ^[[<b;x;yM
          // release: ^[[<b;x;ym
          break;
        case 1015: // urxvt ext mode mouse
          this.urxvtMouse = true;
          // for wide terminals
          // numbers for fields
          // press: ^[[b;x;yM
          // motion: ^[[b;x;yT
          break;
        case 25: // show cursor
          this.cursorHidden = false;
          break;
        case 1049: // alt screen buffer cursor
          //this.saveCursor();
          // FALL-THROUGH
        case 47: // alt screen buffer
        case 1047: // alt screen buffer
          if (!this.normal) {
            var normal = {
              cols: this.cols,
              rows: this.rows,
              lines: this.lines,
              ybase: this.ybase,
              ydisp: this.ydisp,
              x: this.x,
              y: this.y,
              scrollTop: this.scrollTop,
              scrollBottom: this.scrollBottom,
              tabs: this.tabs
              // XXX save charset(s) here?
              // charset: this.charset,
              // glevel: this.glevel,
              // charsets: this.charsets
            };
            this.reset();
            this.normal = normal;
            this.showCursor();
          }
          break;
      }
    }
  };

  // CSI Pm l  Reset Mode (RM).
  //     Ps = 2  -> Keyboard Action Mode (AM).
  //     Ps = 4  -> Replace Mode (IRM).
  //     Ps = 1 2  -> Send/receive (SRM).
  //     Ps = 2 0  -> Normal Linefeed (LNM).
  // CSI ? Pm l
  //   DEC Private Mode Reset (DECRST).
  //     Ps = 1  -> Normal Cursor Keys (DECCKM).
  //     Ps = 2  -> Designate VT52 mode (DECANM).
  //     Ps = 3  -> 80 Column Mode (DECCOLM).
  //     Ps = 4  -> Jump (Fast) Scroll (DECSCLM).
  //     Ps = 5  -> Normal Video (DECSCNM).
  //     Ps = 6  -> Normal Cursor Mode (DECOM).
  //     Ps = 7  -> No Wraparound Mode (DECAWM).
  //     Ps = 8  -> No Auto-repeat Keys (DECARM).
  //     Ps = 9  -> Don't send Mouse X & Y on button press.
  //     Ps = 1 0  -> Hide toolbar (rxvt).
  //     Ps = 1 2  -> Stop Blinking Cursor (att610).
  //     Ps = 1 8  -> Don't print form feed (DECPFF).
  //     Ps = 1 9  -> Limit print to scrolling region (DECPEX).
  //     Ps = 2 5  -> Hide Cursor (DECTCEM).
  //     Ps = 3 0  -> Don't show scrollbar (rxvt).
  //     Ps = 3 5  -> Disable font-shifting functions (rxvt).
  //     Ps = 4 0  -> Disallow 80 -> 132 Mode.
  //     Ps = 4 1  -> No more(1) fix (see curses resource).
  //     Ps = 4 2  -> Disable Nation Replacement Character sets (DEC-
  //     NRCM).
  //     Ps = 4 4  -> Turn Off Margin Bell.
  //     Ps = 4 5  -> No Reverse-wraparound Mode.
  //     Ps = 4 6  -> Stop Logging.  (This is normally disabled by a
  //     compile-time option).
  //     Ps = 4 7  -> Use Normal Screen Buffer.
  //     Ps = 6 6  -> Numeric keypad (DECNKM).
  //     Ps = 6 7  -> Backarrow key sends delete (DECBKM).
  //     Ps = 1 0 0 0  -> Don't send Mouse X & Y on button press and
  //     release.  See the section Mouse Tracking.
  //     Ps = 1 0 0 1  -> Don't use Hilite Mouse Tracking.
  //     Ps = 1 0 0 2  -> Don't use Cell Motion Mouse Tracking.
  //     Ps = 1 0 0 3  -> Don't use All Motion Mouse Tracking.
  //     Ps = 1 0 0 4  -> Don't send FocusIn/FocusOut events.
  //     Ps = 1 0 0 5  -> Disable Extended Mouse Mode.
  //     Ps = 1 0 1 0  -> Don't scroll to bottom on tty output
  //     (rxvt).
  //     Ps = 1 0 1 1  -> Don't scroll to bottom on key press (rxvt).
  //     Ps = 1 0 3 4  -> Don't interpret "meta" key.  (This disables
  //     the eightBitInput resource).
  //     Ps = 1 0 3 5  -> Disable special modifiers for Alt and Num-
  //     Lock keys.  (This disables the numLock resource).
  //     Ps = 1 0 3 6  -> Don't send ESC  when Meta modifies a key.
  //     (This disables the metaSendsEscape resource).
  //     Ps = 1 0 3 7  -> Send VT220 Remove from the editing-keypad
  //     Delete key.
  //     Ps = 1 0 3 9  -> Don't send ESC  when Alt modifies a key.
  //     (This disables the altSendsEscape resource).
  //     Ps = 1 0 4 0  -> Do not keep selection when not highlighted.
  //     (This disables the keepSelection resource).
  //     Ps = 1 0 4 1  -> Use the PRIMARY selection.  (This disables
  //     the selectToClipboard resource).
  //     Ps = 1 0 4 2  -> Disable Urgency window manager hint when
  //     Control-G is received.  (This disables the bellIsUrgent
  //     resource).
  //     Ps = 1 0 4 3  -> Disable raising of the window when Control-
  //     G is received.  (This disables the popOnBell resource).
  //     Ps = 1 0 4 7  -> Use Normal Screen Buffer, clearing screen
  //     first if in the Alternate Screen.  (This may be disabled by
  //     the titeInhibit resource).
  //     Ps = 1 0 4 8  -> Restore cursor as in DECRC.  (This may be
  //     disabled by the titeInhibit resource).
  //     Ps = 1 0 4 9  -> Use Normal Screen Buffer and restore cursor
  //     as in DECRC.  (This may be disabled by the titeInhibit
  //     resource).  This combines the effects of the 1 0 4 7  and 1 0
  //     4 8  modes.  Use this with terminfo-based applications rather
  //     than the 4 7  mode.
  //     Ps = 1 0 5 0  -> Reset terminfo/termcap function-key mode.
  //     Ps = 1 0 5 1  -> Reset Sun function-key mode.
  //     Ps = 1 0 5 2  -> Reset HP function-key mode.
  //     Ps = 1 0 5 3  -> Reset SCO function-key mode.
  //     Ps = 1 0 6 0  -> Reset legacy keyboard emulation (X11R6).
  //     Ps = 1 0 6 1  -> Reset keyboard emulation to Sun/PC style.
  //     Ps = 2 0 0 4  -> Reset bracketed paste mode.
  resetMode(params) {
    var currentcols;
    var currentrows;
    
    if (typeof params === 'object') {
      var l = params.length;
      var i = 0;

      for (; i < l; i++) {
        this.resetMode(params[i]);
      }

      return;
    }

    if (!this.prefix) {
      switch (params) {
        case 4:
          this.insertMode = false;
          break;
        case 20:
          //this.convertEol = false;
          break;
      }
    } else if (this.prefix === '?') {
      switch (params) {
        case 1:
          this.applicationCursor = false;
          break;
        case 3:
          if (this.cols === 132 && this.savedCols) {
            this.resize(this.savedCols, this.rows);
          }
          break;
        case 6:
          this.originMode = false;
          break;
        case 7:
          this.wraparoundMode = false;
          break;
        case 12:
          // this.cursorBlink = false;
          break;
        case 66:
          this.log('Switching back to normal keypad.');
          this.applicationKeypad = false;
          break;
        case 9: // X10 Mouse
        case 1000: // vt200 mouse
        case 1002: // button event mouse
        case 1003: // any event mouse
          this.x10Mouse = false;
          this.vt200Mouse = false;
          this.normalMouse = false;
          this.mouseEvents = false;
          this.element.style.cursor = '';
          break;
        case 1004: // send focusin/focusout events
          this.sendFocus = false;
          break;
        case 1005: // utf8 ext mode mouse
          this.utfMouse = false;
          break;
        case 1006: // sgr ext mode mouse
          this.sgrMouse = false;
          break;
        case 1015: // urxvt ext mode mouse
          this.urxvtMouse = false;
          break;
        case 25: // hide cursor
          this.cursorHidden = true;
          break;
        case 1049: // alt screen buffer cursor
          // FALL-THROUGH
        case 47: // normal screen buffer
        case 1047: // normal screen buffer - clearing it first
          if (this.normal) {
            currentcols = this.cols;
            currentrows = this.rows;
            
            this.lines = this.normal.lines;
            this.cols = this.normal.cols;
            this.rows = this.normal.rows;
            this.ybase = this.normal.ybase;
            this.ydisp = this.normal.ydisp;
            this.x = this.normal.x;
            this.y = this.normal.y;
            this.scrollTop = this.normal.scrollTop;
            this.scrollBottom = this.normal.scrollBottom;
            this.tabs = this.normal.tabs;
            this.normal = null;
            // if (params === 1049) {
            //   this.x = this.savedX;
            //   this.y = this.savedY;
            // }
            this.resize(currentcols, currentrows);
            this.refresh(0, this.rows - 1);
            this.showCursor();
          }
          break;
      }
    }
  };

  // CSI Ps ; Ps r
  //   Set Scrolling Region [top;bottom] (default = full size of win-
  //   dow) (DECSTBM).
  // CSI ? Pm r
  setScrollRegion(params) {
    if (this.prefix) return;
    this.scrollTop = (params[0] || 1) - 1;
    this.scrollBottom = (params[1] || this.rows) - 1;
    this.x = 0;
    this.y = 0;
  };

  // CSI s
  //   Save cursor (ANSI.SYS).
  saveCursor() {
    this.savedX = this.x;
    this.savedY = this.y;
  };

  // CSI u
  //   Restore cursor (ANSI.SYS).
  restoreCursor() {
    this.x = this.savedX || 0;
    this.y = this.savedY || 0;
  };

  /**
   * Lesser Used
   */

  // CSI Ps I
  //   Cursor Forward Tabulation Ps tab stops (default = 1) (CHT).
  cursorForwardTab(params) {
    var param = params[0] || 1;
    while (param--) {
      this.x = this.nextStop();
    }
  };

  // CSI Ps S  Scroll up Ps lines (default = 1) (SU).
  scrollUp(params) {
    var param = params[0] || 1;
    while (param--) {
      this.lines.splice(this.ybase + this.scrollTop, 1);
      this.lines.splice(this.ybase + this.scrollBottom, 0, this.blankLine());
    }
    // this.maxRange();
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
  };

  // CSI Ps T  Scroll down Ps lines (default = 1) (SD).
  scrollDown(params) {
    var param = params[0] || 1;
    while (param--) {
      this.lines.splice(this.ybase + this.scrollBottom, 1);
      this.lines.splice(this.ybase + this.scrollTop, 0, this.blankLine());
    }
    // this.maxRange();
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
  };

  // CSI Ps ; Ps ; Ps ; Ps ; Ps T
  //   Initiate highlight mouse tracking.  Parameters are
  //   [func;startx;starty;firstrow;lastrow].  See the section Mouse
  //   Tracking.
  initMouseTracking(params) {
    // Relevant: DECSET 1001
  };

  // CSI > Ps; Ps T
  //   Reset one or more features of the title modes to the default
  //   value.  Normally, "reset" disables the feature.  It is possi-
  //   ble to disable the ability to reset features by compiling a
  //   different default for the title modes into xterm.
  //     Ps = 0  -> Do not set window/icon labels using hexadecimal.
  //     Ps = 1  -> Do not query window/icon labels using hexadeci-
  //     mal.
  //     Ps = 2  -> Do not set window/icon labels using UTF-8.
  //     Ps = 3  -> Do not query window/icon labels using UTF-8.
  //   (See discussion of "Title Modes").
  resetTitleModes(params) {
  };

  // CSI Ps Z  Cursor Backward Tabulation Ps tab stops (default = 1) (CBT).
  cursorBackwardTab(params) {
    var param = params[0] || 1;
    while (param--) {
      this.x = this.prevStop();
    }
  };

  // CSI Ps b  Repeat the preceding graphic character Ps times (REP).
  repeatPrecedingCharacter(params) {
    var param = params[0] || 1;
    var line = this._getLine(this.ybase + this.y);
    var ch = line[this.x - 1] || [this.defAttr, ' '];

    while (param--) {
      line[this.x] = ch;
      this.x++;
    }
  };

  // CSI Ps g  Tab Clear (TBC).
  //     Ps = 0  -> Clear Current Column (default).
  //     Ps = 3  -> Clear All.
  // Potentially:
  //   Ps = 2  -> Clear Stops on Line.
  //   http://vt100.net/annarbor/aaa-ug/section6.html
  tabClear(params) {
    var param = params[0];
    if (param <= 0) {
      delete this.tabs[this.x];
    } else if (param === 3) {
      this.tabs = {};
    }
  };

  // CSI Pm i  Media Copy (MC).
  //     Ps = 0  -> Print screen (default).
  //     Ps = 4  -> Turn off printer controller mode.
  //     Ps = 5  -> Turn on printer controller mode.
  // CSI ? Pm i
  //   Media Copy (MC, DEC-specific).
  //     Ps = 1  -> Print line containing cursor.
  //     Ps = 4  -> Turn off autoprint mode.
  //     Ps = 5  -> Turn on autoprint mode.
  //     Ps = 1  0  -> Print composed display, ignores DECPEX.
  //     Ps = 1  1  -> Print all pages.
  mediaCopy(params) {
  };

  // CSI > Ps; Ps m
  //   Set or reset resource-values used by xterm to decide whether
  //   to construct escape sequences holding information about the
  //   modifiers pressed with a given key.  The first parameter iden-
  //   tifies the resource to set/reset.  The second parameter is the
  //   value to assign to the resource.  If the second parameter is
  //   omitted, the resource is reset to its initial value.
  //     Ps = 1  -> modifyCursorKeys.
  //     Ps = 2  -> modifyFunctionKeys.
  //     Ps = 4  -> modifyOtherKeys.
  //   If no parameters are given, all resources are reset to their
  //   initial values.
  setResources(params) {
  };

  // CSI > Ps n
  //   Disable modifiers which may be enabled via the CSI > Ps; Ps m
  //   sequence.  This corresponds to a resource value of "-1", which
  //   cannot be set with the other sequence.  The parameter identi-
  //   fies the resource to be disabled:
  //     Ps = 1  -> modifyCursorKeys.
  //     Ps = 2  -> modifyFunctionKeys.
  //     Ps = 4  -> modifyOtherKeys.
  //   If the parameter is omitted, modifyFunctionKeys is disabled.
  //   When modifyFunctionKeys is disabled, xterm uses the modifier
  //   keys to make an extended sequence of functions rather than
  //   adding a parameter to each function key to denote the modi-
  //   fiers.
  disableModifiers(params) {
  };

  // CSI > Ps p
  //   Set resource value pointerMode.  This is used by xterm to
  //   decide whether to hide the pointer cursor as the user types.
  //   Valid values for the parameter:
  //     Ps = 0  -> never hide the pointer.
  //     Ps = 1  -> hide if the mouse tracking mode is not enabled.
  //     Ps = 2  -> always hide the pointer.  If no parameter is
  //     given, xterm uses the default, which is 1 .
  setPointerMode(params) {
  };

  // CSI ! p   Soft terminal reset (DECSTR).
  // http://vt100.net/docs/vt220-rm/table4-10.html
  softReset(params) {
    this.cursorHidden = false;
    this.insertMode = false;
    this.originMode = false;
    this.wraparoundMode = false; // autowrap
    this.applicationKeypad = false; // ?
    this.applicationCursor = false;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.curAttr = this.defAttr;
    this.x = this.y = 0; // ?
    this.charset = null;
    this.glevel = 0; // ??
    this.charsets = [null]; // ??
  };

  // CSI Ps$ p
  //   Request ANSI mode (DECRQM).  For VT300 and up, reply is
  //     CSI Ps; Pm$ y
  //   where Ps is the mode number as in RM, and Pm is the mode
  //   value:
  //     0 - not recognized
  //     1 - set
  //     2 - reset
  //     3 - permanently set
  //     4 - permanently reset
  requestAnsiMode(params) {
  };

  // CSI ? Ps$ p
  //   Request DEC private mode (DECRQM).  For VT300 and up, reply is
  //     CSI ? Ps; Pm$ p
  //   where Ps is the mode number as in DECSET, Pm is the mode value
  //   as in the ANSI DECRQM.
  requestPrivateMode(params) {
  };

  // CSI Ps ; Ps " p
  //   Set conformance level (DECSCL).  Valid values for the first
  //   parameter:
  //     Ps = 6 1  -> VT100.
  //     Ps = 6 2  -> VT200.
  //     Ps = 6 3  -> VT300.
  //   Valid values for the second parameter:
  //     Ps = 0  -> 8-bit controls.
  //     Ps = 1  -> 7-bit controls (always set for VT100).
  //     Ps = 2  -> 8-bit controls.
  setConformanceLevel(params) {
  };

  // CSI Ps q  Load LEDs (DECLL).
  //     Ps = 0  -> Clear all LEDS (default).
  //     Ps = 1  -> Light Num Lock.
  //     Ps = 2  -> Light Caps Lock.
  //     Ps = 3  -> Light Scroll Lock.
  //     Ps = 2  1  -> Extinguish Num Lock.
  //     Ps = 2  2  -> Extinguish Caps Lock.
  //     Ps = 2  3  -> Extinguish Scroll Lock.
  loadLEDs(params) {
  };

  // CSI Ps SP q
  //   Set cursor style (DECSCUSR, VT520).
  //     Ps = 0  -> blinking block.
  //     Ps = 1  -> blinking block (default).
  //     Ps = 2  -> steady block.
  //     Ps = 3  -> blinking underline.
  //     Ps = 4  -> steady underline.
  setCursorStyle(params) {
  };

  // CSI Ps " q
  //   Select character protection attribute (DECSCA).  Valid values
  //   for the parameter:
  //     Ps = 0  -> DECSED and DECSEL can erase (default).
  //     Ps = 1  -> DECSED and DECSEL cannot erase.
  //     Ps = 2  -> DECSED and DECSEL can erase.
  setCharProtectionAttr(params) {
  };

  // CSI ? Pm r
  //   Restore DEC Private Mode Values.  The value of Ps previously
  //   saved is restored.  Ps values are the same as for DECSET.
  restorePrivateValues(params) {
  };

  // CSI Pt; Pl; Pb; Pr; Ps$ r
  //   Change Attributes in Rectangular Area (DECCARA), VT400 and up.
  //     Pt; Pl; Pb; Pr denotes the rectangle.
  //     Ps denotes the SGR attributes to change: 0, 1, 4, 5, 7.
  // NOTE: xterm doesn't enable this code by default.
  setAttrInRectangle(params) {
    var t = params[0];
    var l = params[1];
    var b = params[2];
    var r = params[3];
    var attr = params[4];

    var line;
    var i;

    for (; t < b + 1; t++) {
      line = this._getLine(this.ybase + t);
      for (i = l; i < r; i++) {
        line[i] = [attr, line[i][1]];
      }
    }

    // this.maxRange();
    this.updateRange(params[0]);
    this.updateRange(params[2]);
  };

  // CSI ? Pm s
  //   Save DEC Private Mode Values.  Ps values are the same as for
  //   DECSET.
  savePrivateValues(params) {
  };

  // CSI Ps ; Ps ; Ps t
  //   Window manipulation (from dtterm, as well as extensions).
  //   These controls may be disabled using the allowWindowOps
  //   resource.  Valid values for the first (and any additional
  //   parameters) are:
  //     Ps = 1  -> De-iconify window.
  //     Ps = 2  -> Iconify window.
  //     Ps = 3  ;  x ;  y -> Move window to [x, y].
  //     Ps = 4  ;  height ;  width -> Resize the xterm window to
  //     height and width in pixels.
  //     Ps = 5  -> Raise the xterm window to the front of the stack-
  //     ing order.
  //     Ps = 6  -> Lower the xterm window to the bottom of the
  //     stacking order.
  //     Ps = 7  -> Refresh the xterm window.
  //     Ps = 8  ;  height ;  width -> Resize the text area to
  //     [height;width] in characters.
  //     Ps = 9  ;  0  -> Restore maximized window.
  //     Ps = 9  ;  1  -> Maximize window (i.e., resize to screen
  //     size).
  //     Ps = 1 0  ;  0  -> Undo full-screen mode.
  //     Ps = 1 0  ;  1  -> Change to full-screen.
  //     Ps = 1 1  -> Report xterm window state.  If the xterm window
  //     is open (non-iconified), it returns CSI 1 t .  If the xterm
  //     window is iconified, it returns CSI 2 t .
  //     Ps = 1 3  -> Report xterm window position.  Result is CSI 3
  //     ; x ; y t
  //     Ps = 1 4  -> Report xterm window in pixels.  Result is CSI
  //     4  ;  height ;  width t
  //     Ps = 1 8  -> Report the size of the text area in characters.
  //     Result is CSI  8  ;  height ;  width t
  //     Ps = 1 9  -> Report the size of the screen in characters.
  //     Result is CSI  9  ;  height ;  width t
  //     Ps = 2 0  -> Report xterm window's icon label.  Result is
  //     OSC  L  label ST
  //     Ps = 2 1  -> Report xterm window's title.  Result is OSC  l
  //     label ST
  //     Ps = 2 2  ;  0  -> Save xterm icon and window title on
  //     stack.
  //     Ps = 2 2  ;  1  -> Save xterm icon title on stack.
  //     Ps = 2 2  ;  2  -> Save xterm window title on stack.
  //     Ps = 2 3  ;  0  -> Restore xterm icon and window title from
  //     stack.
  //     Ps = 2 3  ;  1  -> Restore xterm icon title from stack.
  //     Ps = 2 3  ;  2  -> Restore xterm window title from stack.
  //     Ps >= 2 4  -> Resize to Ps lines (DECSLPP).
  manipulateWindow(params) {
  };

  // CSI Pt; Pl; Pb; Pr; Ps$ t
  //   Reverse Attributes in Rectangular Area (DECRARA), VT400 and
  //   up.
  //     Pt; Pl; Pb; Pr denotes the rectangle.
  //     Ps denotes the attributes to reverse, i.e.,  1, 4, 5, 7.
  // NOTE: xterm doesn't enable this code by default.
  reverseAttrInRectangle(params) {
  };

  // CSI > Ps; Ps t
  //   Set one or more features of the title modes.  Each parameter
  //   enables a single feature.
  //     Ps = 0  -> Set window/icon labels using hexadecimal.
  //     Ps = 1  -> Query window/icon labels using hexadecimal.
  //     Ps = 2  -> Set window/icon labels using UTF-8.
  //     Ps = 3  -> Query window/icon labels using UTF-8.  (See dis-
  //     cussion of "Title Modes")
  setTitleModeFeature(params) {
  };

  // CSI Ps SP t
  //   Set warning-bell volume (DECSWBV, VT520).
  //     Ps = 0  or 1  -> off.
  //     Ps = 2 , 3  or 4  -> low.
  //     Ps = 5 , 6 , 7 , or 8  -> high.
  setWarningBellVolume(params) {
  };

  // CSI Ps SP u
  //   Set margin-bell volume (DECSMBV, VT520).
  //     Ps = 1  -> off.
  //     Ps = 2 , 3  or 4  -> low.
  //     Ps = 0 , 5 , 6 , 7 , or 8  -> high.
  setMarginBellVolume(params) {
  };

  // CSI Pt; Pl; Pb; Pr; Pp; Pt; Pl; Pp$ v
  //   Copy Rectangular Area (DECCRA, VT400 and up).
  //     Pt; Pl; Pb; Pr denotes the rectangle.
  //     Pp denotes the source page.
  //     Pt; Pl denotes the target location.
  //     Pp denotes the target page.
  // NOTE: xterm doesn't enable this code by default.
  copyRectangle(params) {
  };

  // CSI Pt ; Pl ; Pb ; Pr ' w
  //   Enable Filter Rectangle (DECEFR), VT420 and up.
  //   Parameters are [top;left;bottom;right].
  //   Defines the coordinates of a filter rectangle and activates
  //   it.  Anytime the locator is detected outside of the filter
  //   rectangle, an outside rectangle event is generated and the
  //   rectangle is disabled.  Filter rectangles are always treated
  //   as "one-shot" events.  Any parameters that are omitted default
  //   to the current locator position.  If all parameters are omit-
  //   ted, any locator motion will be reported.  DECELR always can-
  //   cels any prevous rectangle definition.
  enableFilterRectangle(params) {
  };

  // CSI Ps x  Request Terminal Parameters (DECREQTPARM).
  //   if Ps is a "0" (default) or "1", and xterm is emulating VT100,
  //   the control sequence elicits a response of the same form whose
  //   parameters describe the terminal:
  //     Ps -> the given Ps incremented by 2.
  //     Pn = 1  <- no parity.
  //     Pn = 1  <- eight bits.
  //     Pn = 1  <- 2  8  transmit 38.4k baud.
  //     Pn = 1  <- 2  8  receive 38.4k baud.
  //     Pn = 1  <- clock multiplier.
  //     Pn = 0  <- STP flags.
  requestParameters(params) {
  };

  // CSI Ps x  Select Attribute Change Extent (DECSACE).
  //     Ps = 0  -> from start to end position, wrapped.
  //     Ps = 1  -> from start to end position, wrapped.
  //     Ps = 2  -> rectangle (exact).
  selectChangeExtent(params) {
  };

  // CSI Pc; Pt; Pl; Pb; Pr$ x
  //   Fill Rectangular Area (DECFRA), VT420 and up.
  //     Pc is the character to use.
  //     Pt; Pl; Pb; Pr denotes the rectangle.
  // NOTE: xterm doesn't enable this code by default.
  fillRectangle(params) {
    var ch = params[0];
    var t = params[1];
    var l = params[2];
    var b = params[3];
    var r = params[4];

    var line;
    var i;

    for (; t < b + 1; t++) {
      line = this._getLine(this.ybase + t);
      for (i = l; i < r; i++) {
        line[i] = [line[i][0], String.fromCharCode(ch)];
      }
    }

    // this.maxRange();
    this.updateRange(params[1]);
    this.updateRange(params[3]);
  };

  // CSI Ps ; Pu ' z
  //   Enable Locator Reporting (DECELR).
  //   Valid values for the first parameter:
  //     Ps = 0  -> Locator disabled (default).
  //     Ps = 1  -> Locator enabled.
  //     Ps = 2  -> Locator enabled for one report, then disabled.
  //   The second parameter specifies the coordinate unit for locator
  //   reports.
  //   Valid values for the second parameter:
  //     Pu = 0  <- or omitted -> default to character cells.
  //     Pu = 1  <- device physical pixels.
  //     Pu = 2  <- character cells.
  enableLocatorReporting(params) {
  //  var val = params[0] > 0;
    //this.mouseEvents = val;
    //this.decLocator = val;
  };

  // CSI Pt; Pl; Pb; Pr$ z
  //   Erase Rectangular Area (DECERA), VT400 and up.
  //     Pt; Pl; Pb; Pr denotes the rectangle.
  // NOTE: xterm doesn't enable this code by default.
  eraseRectangle(params) {
    var t = params[0];
    var l = params[1];
    var b = params[2];
    var r = params[3];

    var line;
    var i;
    var ch;

    ch = [this.eraseAttr(), ' ']; // xterm?

    for (; t < b + 1; t++) {
      line = this._getLine(this.ybase + t);
      for (i = l; i < r; i++) {
        line[i] = ch;
      }
    }

    // this.maxRange();
    this.updateRange(params[0]);
    this.updateRange(params[2]);
  };

  // CSI Pm ' {
  //   Select Locator Events (DECSLE).
  //   Valid values for the first (and any additional parameters)
  //   are:
  //     Ps = 0  -> only respond to explicit host requests (DECRQLP).
  //                (This is default).  It also cancels any filter
  //   rectangle.
  //     Ps = 1  -> report button down transitions.
  //     Ps = 2  -> do not report button down transitions.
  //     Ps = 3  -> report button up transitions.
  //     Ps = 4  -> do not report button up transitions.
  setLocatorEvents(params) {
  }

  // CSI Pt; Pl; Pb; Pr$ {
  //   Selective Erase Rectangular Area (DECSERA), VT400 and up.
  //     Pt; Pl; Pb; Pr denotes the rectangle.
  selectiveEraseRectangle(params) {
  }

  // CSI Ps ' |
  //   Request Locator Position (DECRQLP).
  //   Valid values for the parameter are:
  //     Ps = 0 , 1 or omitted -> transmit a single DECLRP locator
  //     report.

  //   If Locator Reporting has been enabled by a DECELR, xterm will
  //   respond with a DECLRP Locator Report.  This report is also
  //   generated on button up and down events if they have been
  //   enabled with a DECSLE, or when the locator is detected outside
  //   of a filter rectangle, if filter rectangles have been enabled
  //   with a DECEFR.

  //     -> CSI Pe ; Pb ; Pr ; Pc ; Pp &  w

  //   Parameters are [event;button;row;column;page].
  //   Valid values for the event:
  //     Pe = 0  -> locator unavailable - no other parameters sent.
  //     Pe = 1  -> request - xterm received a DECRQLP.
  //     Pe = 2  -> left button down.
  //     Pe = 3  -> left button up.
  //     Pe = 4  -> middle button down.
  //     Pe = 5  -> middle button up.
  //     Pe = 6  -> right button down.
  //     Pe = 7  -> right button up.
  //     Pe = 8  -> M4 button down.
  //     Pe = 9  -> M4 button up.
  //     Pe = 1 0  -> locator outside filter rectangle.
  //   ``button'' parameter is a bitmask indicating which buttons are
  //     pressed:
  //     Pb = 0  <- no buttons down.
  //     Pb & 1  <- right button down.
  //     Pb & 2  <- middle button down.
  //     Pb & 4  <- left button down.
  //     Pb & 8  <- M4 button down.
  //   ``row'' and ``column'' parameters are the coordinates of the
  //     locator position in the xterm window, encoded as ASCII deci-
  //     mal.
  //   The ``page'' parameter is not used by xterm, and will be omit-
  //   ted.
  requestLocatorPosition(params) {
  };

  // CSI P m SP }
  // Insert P s Column(s) (default = 1) (DECIC), VT420 and up.
  // NOTE: xterm doesn't enable this code by default.
  insertColumns(params) {
    var param = params[0];
    var l = this.ybase + this.rows;
    var ch = [this.eraseAttr(), ' ']; // xterm?
    var i;
    var line;

    while (param--) {
      for (i = this.ybase; i < l; i++) {
        line = this._getLine(i);
        line.splice(this.x + 1, 0, ch);
        line.pop();
      }
    }

    this.maxRange();
  }

  // CSI P m SP ~
  // Delete P s Column(s) (default = 1) (DECDC), VT420 and up
  // NOTE: xterm doesn't enable this code by default.
  deleteColumns(params) {
    var param = params[0];
    var l = this.ybase + this.rows;
    var ch = [this.eraseAttr(), ' ']; // xterm?
    var i;
    var line;

    while (param--) {
      for (i = this.ybase; i < l; i++) {
        line = this._getLine(i);
        line.splice(this.x, 1);
        line.push(ch);
      }
    }

    this.maxRange();
  };

  /**
   * Prefix/Select/Visual/Search Modes
   */

  enterPrefix() {
    this.prefixMode = true;
  };

  leavePrefix() {
    this.prefixMode = false;
  };

  enterSelect() {
    this._real = {
      x: this.x,
      y: this.y,
      ydisp: this.ydisp,
      ybase: this.ybase,
      cursorHidden: this.cursorHidden,
      lines: this.copyBuffer(this.lines),
      write: this.write
    };
    this.write = function() {};
    this.selectMode = true;
    this.visualMode = false;
    this.cursorHidden = false;
    this.refresh(this.y, this.y);
  };

  leaveSelect() {
    this.x = this._real.x;
    this.y = this._real.y;
    this.ydisp = this._real.ydisp;
    this.ybase = this._real.ybase;
    this.cursorHidden = this._real.cursorHidden;
    this.lines = this._real.lines;
    this.write = this._real.write;
    delete this._real;
    this.selectMode = false;
    this.visualMode = false;
    this.refresh(0, this.rows - 1);
  };

  enterVisual() {
    this._real.preVisual = this.copyBuffer(this.lines);
    this.selectText(this.x, this.x, this.ydisp + this.y, this.ydisp + this.y);
    this.visualMode = true;
  };

  leaveVisual() {
    this.lines = this._real.preVisual;
    delete this._real.preVisual;
    delete this._selected;
    this.visualMode = false;
    this.refresh(0, this.rows - 1);
  };

  enterSearch(down) {
    this.entry = '';
    this.searchMode = true;
    this.searchDown = down;
    this._real.preSearch = this.copyBuffer(this.lines);
    this._real.preSearchX = this.x;
    this._real.preSearchY = this.y;

    var bottom = this.ydisp + this.rows - 1;
    for (var i = 0; i < this.entryPrefix.length; i++) {
      //this.lines[bottom][i][0] = (this.defAttr & ~0x1ff) | 4;
      //this.lines[bottom][i][1] = this.entryPrefix[i];
      this._getLine(bottom)[i] = [
        (this.defAttr & ~0x1ff) | 4,
        this.entryPrefix[i]
      ];
    }

    this.y = this.rows - 1;
    this.x = this.entryPrefix.length;

    this.refresh(this.rows - 1, this.rows - 1);
  };

  leaveSearch() {
    this.searchMode = false;

    if (this._real.preSearch) {
      this.lines = this._real.preSearch;
      this.x = this._real.preSearchX;
      this.y = this._real.preSearchY;
      delete this._real.preSearch;
      delete this._real.preSearchX;
      delete this._real.preSearchY;
    }

    this.refresh(this.rows - 1, this.rows - 1);
  };

  copyBuffer(lines) {
    var out = [];
    if (lines === undefined || lines === null) {
      lines = this.lines;
    }

    for (var y = 0; y < lines.length; y++) {
      out[y] = [];
      for (var x = 0; x < lines[y].length; x++) {
        out[y][x] = [lines[y][x][0], lines[y][x][1]];
      }
    }

    return out;
  }

  // getCopyTextarea(text) {
  //   var textarea = this._copyTextarea;
  //   var document = this.document;
  // 
  //   if (!textarea) {
  //     textarea = document.createElement('textarea');
  //     textarea.style.position = 'absolute';
  //     textarea.style.left = '-32000px';
  //     textarea.style.top = '-32000px';
  //     textarea.style.width = '0px';
  //     textarea.style.height = '0px';
  //     textarea.style.opacity = '0';
  //     textarea.style.backgroundColor = 'transparent';
  //     textarea.style.borderStyle = 'none';
  //     textarea.style.outlineStyle = 'none';
  // 
  //     document.getElementsByTagName('body')[0].appendChild(textarea);
  // 
  //     this._copyTextarea = textarea;
  //   }
  // 
  //   return textarea;
  // };

  // NOTE: Only works for primary selection on X11.
  // Non-X11 users should use Ctrl-C instead.
  // copyText(text) {
  //   var self = this;
  //   var textarea = this.getCopyTextarea();
  // 
  //   this.emit('copy', text);
  // 
  //   textarea.focus();
  //   textarea.textContent = text;
  //   textarea.value = text;
  //   textarea.setSelectionRange(0, text.length);
  // 
  //   setTimeout(function() {
  //     self.element.focus();
  //     self.focus();
  //   }, 1);
  // };

  selectText(x1, x2, y1, y2) {
    var ox1;
    var ox2;
    var oy1;
    var oy2;
    var tmp;
    var x;
    var y;
    var xl;
    var attr;
    var line;

    if (this._selected) {
      ox1 = this._selected.x1;
      ox2 = this._selected.x2;
      oy1 = this._selected.y1;
      oy2 = this._selected.y2;

      if (oy2 < oy1) {
        tmp = ox2;
        ox2 = ox1;
        ox1 = tmp;
        tmp = oy2;
        oy2 = oy1;
        oy1 = tmp;
      }

      if (ox2 < ox1 && oy1 === oy2) {
        tmp = ox2;
        ox2 = ox1;
        ox1 = tmp;
      }

      for (y = oy1; y <= oy2; y++) {
        x = 0;
        xl = this.cols - 1;
        if (y === oy1) {
          x = ox1;
        }
        if (y === oy2) {
          xl = ox2;
        }
        
        line = this._getLine(y);
        for (; x <= xl; x++) {
          if (line[x].old !== undefined && line[x].old !== null) {
            //this.lines[y][x][0] = this.lines[y][x].old;
            //delete this.lines[y][x].old;
            attr = line[x].old;
            delete line[x].old;
            line[x] = [attr, line[x][1]];
          }
        }
      }

      y1 = this._selected.y1;
      x1 = this._selected.x1;
    }

    y1 = Math.max(y1, 0);
    y1 = Math.min(y1, this.ydisp + this.rows - 1);

    y2 = Math.max(y2, 0);
    y2 = Math.min(y2, this.ydisp + this.rows - 1);

    this._selected = { x1: x1, x2: x2, y1: y1, y2: y2 };

    if (y2 < y1) {
      tmp = x2;
      x2 = x1;
      x1 = tmp;
      tmp = y2;
      y2 = y1;
      y1 = tmp;
    }

    if (x2 < x1 && y1 === y2) {
      tmp = x2;
      x2 = x1;
      x1 = tmp;
    }

    for (y = y1; y <= y2; y++) {
      x = 0;
      xl = this.cols - 1;
      if (y === y1) {
        x = x1;
      }
      if (y === y2) {
        xl = x2;
      }
      line = this._getLine(y);
      for (; x <= xl; x++) {
        //this.lines[y][x].old = this.lines[y][x][0];
        //this.lines[y][x][0] &= ~0x1ff;
        //this.lines[y][x][0] |= (0x1ff << 9) | 4;
        attr = line[x][0];
        line[x] = [
          (attr & ~0x1ff) | ((0x1ff << 9) | 4),
          line[x][1]
        ];
        line[x].old = attr;
      }
    }

    y1 = y1 - this.ydisp;
    y2 = y2 - this.ydisp;

    y1 = Math.max(y1, 0);
    y1 = Math.min(y1, this.rows - 1);

    y2 = Math.max(y2, 0);
    y2 = Math.min(y2, this.rows - 1);

    //this.refresh(y1, y2);
    this.refresh(0, this.rows - 1);
  };

  grabText(x1, x2, y1, y2) {
    var out = '';
    var buf = '';
    var ch;
    var x;
    var y;
    var xl;
    var tmp;
    var line;

    if (y2 < y1) {
      tmp = x2;
      x2 = x1;
      x1 = tmp;
      tmp = y2;
      y2 = y1;
      y1 = tmp;
    }

    if (x2 < x1 && y1 === y2) {
      tmp = x2;
      x2 = x1;
      x1 = tmp;
    }

    for (y = y1; y <= y2; y++) {
      x = 0;
      xl = this.cols - 1;
      if (y === y1) {
        x = x1;
      }
      if (y === y2) {
        xl = x2;
      }
      line = this._getLine(y);
      for (; x <= xl; x++) {
        ch = line[x][1];
        if (ch === ' ') {
          buf += ch;
          continue;
        }
        if (buf) {
          out += buf;
          buf = '';
        }
        out += ch;
        if (isWide(ch)) x++;
      }
      buf = '';
      out += '\n';
    }

    // If we're not at the end of the
    // line, don't add a newline.
    for (x = x2, y = y2; x < this.cols; x++) {
      if (this._getLine(y)[x][1] !== ' ') {
        out = out.slice(0, -1);
        break;
      }
    }

    return out;
  };

  keyPrefix(ev, key) {
    if (key === 'k' || key === '&') {
      this.destroy();
    } else if (key === 'p' || key === ']') {
      this.emit('request paste');
    } else if (key === 'c') {
      this.emit('request create');
    } else if (key >= '0' && key <= '9') {
      key = +key - 1;
      if (!~key) key = 9;
      this.emit('request term', key);
    } else if (key === 'n') {
      this.emit('request term next');
    } else if (key === 'P') {
      this.emit('request term previous');
    } else if (key === ':') {
      this.emit('request command mode');
    } else if (key === '[') {
      this.enterSelect();
    }
  };

  keySelect(ev, key) {
    var y;
    var x;
    var ox;
    var oy;
    var oyd;
    var yb;
    var line;
    var saw_space;
    
    this.showCursor();

    if (this.searchMode || key === 'n' || key === 'N') {
      return this.keySearch(ev, key);
    }

    if (key === '\x04') { // ctrl-d
      y = this.ydisp + this.y;
      if (this.ydisp === this.ybase) {
        // Mimic vim behavior
        this.y = Math.min(this.y + (this.rows - 1) / 2 | 0, this.rows - 1);
        this.refresh(0, this.rows - 1);
      } else {
        this.scrollDisp((this.rows - 1) / 2 | 0);
      }
      if (this.visualMode) {
        this.selectText(this.x, this.x, y, this.ydisp + this.y);
      }
      return;
    }

    if (key === '\x15') { // ctrl-u
      y = this.ydisp + this.y;
      if (this.ydisp === 0) {
        // Mimic vim behavior
        this.y = Math.max(this.y - (this.rows - 1) / 2 | 0, 0);
        this.refresh(0, this.rows - 1);
      } else {
        this.scrollDisp(-(this.rows - 1) / 2 | 0);
      }
      if (this.visualMode) {
        this.selectText(this.x, this.x, y, this.ydisp + this.y);
      }
      return;
    }

    if (key === '\x06') { // ctrl-f
      y = this.ydisp + this.y;
      this.scrollDisp(this.rows - 1);
      if (this.visualMode) {
        this.selectText(this.x, this.x, y, this.ydisp + this.y);
      }
      return;
    }

    if (key === '\x02') { // ctrl-b
      y = this.ydisp + this.y;
      this.scrollDisp(-(this.rows - 1));
      if (this.visualMode) {
        this.selectText(this.x, this.x, y, this.ydisp + this.y);
      }
      return;
    }

    if (key === 'k' || key === '\x1b[A') {
      y = this.ydisp + this.y;
      this.y--;
      if (this.y < 0) {
        this.y = 0;
        this.scrollDisp(-1);
      }
      if (this.visualMode) {
        this.selectText(this.x, this.x, y, this.ydisp + this.y);
      } else {
        this.refresh(this.y, this.y + 1);
      }
      return;
    }

    if (key === 'j' || key === '\x1b[B') {
      y = this.ydisp + this.y;
      this.y++;
      if (this.y >= this.rows) {
        this.y = this.rows - 1;
        this.scrollDisp(1);
      }
      if (this.visualMode) {
        this.selectText(this.x, this.x, y, this.ydisp + this.y);
      } else {
        this.refresh(this.y - 1, this.y);
      }
      return;
    }

    if (key === 'h' || key === '\x1b[D') {
      x = this.x;
      this.x--;
      if (this.x < 0) {
        this.x = 0;
      }
      if (this.visualMode) {
        this.selectText(x, this.x, this.ydisp + this.y, this.ydisp + this.y);
      } else {
        this.refresh(this.y, this.y);
      }
      return;
    }

    if (key === 'l' || key === '\x1b[C') {
      x = this.x;
      this.x++;
      if (this.x >= this.cols) {
        this.x = this.cols - 1;
      }
      if (this.visualMode) {
        this.selectText(x, this.x, this.ydisp + this.y, this.ydisp + this.y);
      } else {
        this.refresh(this.y, this.y);
      }
      return;
    }

    if (key === 'v' || key === ' ') {
      if (!this.visualMode) {
        this.enterVisual();
      } else {
        this.leaveVisual();
      }
      return;
    }

    if (key === 'y') {
      // if (this.visualMode) {
      //   var text = this.grabText(
      //     this._selected.x1, this._selected.x2,
      //     this._selected.y1, this._selected.y2);
      //   this.copyText(text);
      //   this.leaveVisual();
      //   // this.leaveSelect();
      // }
      return;
    }

    if (key === 'q' || key === '\x1b') {
      if (this.visualMode) {
        this.leaveVisual();
      } else {
        this.leaveSelect();
      }
      return;
    }

    if (key === 'w' || key === 'W') {
      ox = this.x;
      oy = this.y;
      oyd = this.ydisp;

      x = this.x;
      y = this.y;
      yb = this.ydisp;
      saw_space = false;

      for (;;) {
        line = this._getLine(yb + y);
        while (x < this.cols) {
          if (line[x][1] <= ' ') {
            saw_space = true;
          } else if (saw_space) {
            break;
          }
          x++;
        }
        if (x >= this.cols) x = this.cols - 1;
        if (x === this.cols - 1 && line[x][1] <= ' ') {
          x = 0;
          if (++y >= this.rows) {
            y--;
            if (++yb > this.ybase) {
              yb = this.ybase;
              x = this.x;
              break;
            }
          }
          continue;
        }
        break;
      }

      this.x = x;
      this.y = y;
      this.scrollDisp(-this.ydisp + yb);

      if (this.visualMode) {
        this.selectText(ox, this.x, oy + oyd, this.ydisp + this.y);
      }
      return;
    }

    if (key === 'b' || key === 'B') {
      ox = this.x;
      oy = this.y;
      oyd = this.ydisp;

      x = this.x;
      y = this.y;
      yb = this.ydisp;

      for (;;) {
        line = this._getLine(yb + y);
        saw_space = x > 0 && line[x][1] > ' ' && line[x - 1][1] > ' ';
        while (x >= 0) {
          if (line[x][1] <= ' ') {
            if (saw_space && (x + 1 < this.cols && line[x + 1][1] > ' ')) {
              x++;
              break;
            } else {
              saw_space = true;
            }
          }
          x--;
        }
        if (x < 0) x = 0;
        if (x === 0 && (line[x][1] <= ' ' || !saw_space)) {
          x = this.cols - 1;
          if (--y < 0) {
            y++;
            if (--yb < 0) {
              yb++;
              x = 0;
              break;
            }
          }
          continue;
        }
        break;
      }

      this.x = x;
      this.y = y;
      this.scrollDisp(-this.ydisp + yb);

      if (this.visualMode) {
        this.selectText(ox, this.x, oy + oyd, this.ydisp + this.y);
      }
      return;
    }

    if (key === 'e' || key === 'E') {
      x = this.x + 1;
      y = this.y;
      yb = this.ydisp;
      if (x >= this.cols) x--;

      for (;;) {
        line = this._getLine(yb + y);
        while (x < this.cols) {
          if (line[x][1] <= ' ') {
            x++;
          } else {
            break;
          }
        }
        while (x < this.cols) {
          if (line[x][1] <= ' ') {
            if (x - 1 >= 0 && line[x - 1][1] > ' ') {
              x--;
              break;
            }
          }
          x++;
        }
        if (x >= this.cols) x = this.cols - 1;
        if (x === this.cols - 1 && line[x][1] <= ' ') {
          x = 0;
          if (++y >= this.rows) {
            y--;
            if (++yb > this.ybase) {
              yb = this.ybase;
              break;
            }
          }
          continue;
        }
        break;
      }

      this.x = x;
      this.y = y;
      this.scrollDisp(-this.ydisp + yb);

      if (this.visualMode) {
        this.selectText(ox, this.x, oy + oyd, this.ydisp + this.y);
      }
      return;
    }

    if (key === '^' || key === '0') {
      ox = this.x;

      if (key === '0') {
        this.x = 0;
      } else if (key === '^') {
        line = this._getLine(this.ydisp + this.y);
        x = 0;
        while (x < this.cols) {
          if (line[x][1] > ' ') {
            break;
          }
          x++;
        }
        if (x >= this.cols) x = this.cols - 1;
        this.x = x;
      }

      if (this.visualMode) {
        this.selectText(ox, this.x, this.ydisp + this.y, this.ydisp + this.y);
      } else {
        this.refresh(this.y, this.y);
      }
      return;
    }

    if (key === '$') {
      ox = this.x;
      line = this._getLine(this.ydisp + this.y);
      x = this.cols - 1;
      while (x >= 0) {
        if (line[x][1] > ' ') {
          if (this.visualMode && x < this.cols - 1) x++;
          break;
        }
        x--;
      }
      if (x < 0) x = 0;
      this.x = x;
      if (this.visualMode) {
        this.selectText(ox, this.x, this.ydisp + this.y, this.ydisp + this.y);
      } else {
        this.refresh(this.y, this.y);
      }
      return;
    }

    if (key === 'g' || key === 'G') {
      ox = this.x;
      oy = this.y;
      oyd = this.ydisp;
      if (key === 'g') {
        this.x = 0;
        this.y = 0;
        this.scrollDisp(-this.ydisp);
      } else if (key === 'G') {
        this.x = 0;
        this.y = this.rows - 1;
        this.scrollDisp(this.ybase);
      }
      if (this.visualMode) {
        this.selectText(ox, this.x, oy + oyd, this.ydisp + this.y);
      }
      return;
    }

    if (key === 'H' || key === 'M' || key === 'L') {
      ox = this.x;
      oy = this.y;
      if (key === 'H') {
        this.x = 0;
        this.y = 0;
      } else if (key === 'M') {
        this.x = 0;
        this.y = this.rows / 2 | 0;
      } else if (key === 'L') {
        this.x = 0;
        this.y = this.rows - 1;
      }
      if (this.visualMode) {
        this.selectText(ox, this.x, this.ydisp + oy, this.ydisp + this.y);
      } else {
        this.refresh(oy, oy);
        this.refresh(this.y, this.y);
      }
      return;
    }

    if (key === '{' || key === '}') {
      ox = this.x;
      oy = this.y;
      oyd = this.ydisp;

      var saw_full = false;
      var found = false;
      var first_is_space = -1;
      y = this.y + (key === '{' ? -1 : 1);
      yb = this.ydisp;
      var i;

      if (key === '{') {
        if (y < 0) {
          y++;
          if (yb > 0) yb--;
        }
      } else if (key === '}') {
        if (y >= this.rows) {
          y--;
          if (yb < this.ybase) yb++;
        }
      }

      for (;;) {
        line = this._getLine(yb + y);

        for (i = 0; i < this.cols; i++) {
          if (line[i][1] > ' ') {
            if (first_is_space === -1) {
              first_is_space = 0;
            }
            saw_full = true;
            break;
          } else if (i === this.cols - 1) {
            if (first_is_space === -1) {
              first_is_space = 1;
            } else if (first_is_space === 0) {
              found = true;
            } else if (first_is_space === 1) {
              if (saw_full) found = true;
            }
            break;
          }
        }

        if (found) break;

        if (key === '{') {
          y--;
          if (y < 0) {
            y++;
            if (yb > 0) yb--;
            else break;
          }
        } else if (key === '}') {
          y++;
          if (y >= this.rows) {
            y--;
            if (yb < this.ybase) yb++;
            else break;
          }
        }
      }

      if (!found) {
        if (key === '{') {
          y = 0;
          yb = 0;
        } else if (key === '}') {
          y = this.rows - 1;
          yb = this.ybase;
        }
      }

      this.x = 0;
      this.y = y;
      this.scrollDisp(-this.ydisp + yb);

      if (this.visualMode) {
        this.selectText(ox, this.x, oy + oyd, this.ydisp + this.y);
      }
      return;
    }

    if (key === '/' || key === '?') {
      if (!this.visualMode) {
        this.enterSearch(key === '/');
      }
      return;
    }

    return false;
  };

  keySearch(ev, key) {
    var i;
    var bottom;
    
    if (key === '\x1b') {
      this.leaveSearch();
      return;
    }

    if (key === '\r' || (!this.searchMode && (key === 'n' || key === 'N'))) {
      this.leaveSearch();

      var entry = this.entry;

      if (!entry) {
        this.refresh(0, this.rows - 1);
        return;
      }

      var ox = this.x;
      var oy = this.y;
      var oyd = this.ydisp;

      var line;
      var found = false;
      var wrapped = false;
      var x = this.x + 1;
      var y = this.ydisp + this.y;
      var yb;
      var up = key === 'N' ? this.searchDown : !this.searchDown;

      for (;;) {
        line = this._getLine(y);

        while (x < this.cols) {
          for (i = 0; i < entry.length; i++) {
            if (x + i >= this.cols) break;
            if (line[x + i][1] !== entry[i]) {
              break;
            } else if (line[x + i][1] === entry[i] && i === entry.length - 1) {
              found = true;
              break;
            }
          }
          if (found) break;
          x += i + 1;
        }
        if (found) break;

        x = 0;

        if (!up) {
          y++;
          if (y > this.ybase + this.rows - 1) {
            if (wrapped) break;
            // this.setMessage('Search wrapped. Continuing at TOP.');
            wrapped = true;
            y = 0;
          }
        } else {
          y--;
          if (y < 0) {
            if (wrapped) break;
            // this.setMessage('Search wrapped. Continuing at BOTTOM.');
            wrapped = true;
            y = this.ybase + this.rows - 1;
          }
        }
      }

      if (found) {
        if (y - this.ybase < 0) {
          yb = y;
          y = 0;
          if (yb > this.ybase) {
            y = yb - this.ybase;
            yb = this.ybase;
          }
        } else {
          yb = this.ybase;
          y -= this.ybase;
        }

        this.x = x;
        this.y = y;
        this.scrollDisp(-this.ydisp + yb);

        if (this.visualMode) {
          this.selectText(ox, this.x, oy + oyd, this.ydisp + this.y);
        }
        return;
      }

      // this.setMessage("No matches found.");
      this.refresh(0, this.rows - 1);

      return;
    }

    if (key === '\b' || key === '\x7f') {
      if (this.entry.length === 0) return;
      bottom = this.ydisp + this.rows - 1;
      this.entry = this.entry.slice(0, -1);
      i = this.entryPrefix.length + this.entry.length;
      //this.lines[bottom][i][1] = ' ';
      this._getLine(bottom)[i] = [ this._getLine(bottom)[i][0], ' ' ];
      this.x--;
      this.refresh(this.rows - 1, this.rows - 1);
      this.refresh(this.y, this.y);
      return;
    }

    if (key.length === 1 && key >= ' ' && key <= '~') {
      bottom = this.ydisp + this.rows - 1;
      this.entry += key;
      i = this.entryPrefix.length + this.entry.length - 1;
      //this.lines[bottom][i][0] = (this.defAttr & ~0x1ff) | 4;
      //this.lines[bottom][i][1] = key;
      this._getLine(bottom)[i] = [ (this.defAttr & ~0x1ff) | 4, key ];
      this.x++;
      this.refresh(this.rows - 1, this.rows - 1);
      this.refresh(this.y, this.y);
      return;
    }

    return false;
  };

  /**
   * Character Sets
   */

  static charsets = {
    // DEC Special Character and Line Drawing Set.
    // http://vt100.net/docs/vt102-ug/table5-13.html
    // A lot of curses apps use this if they see TERM=xterm.
    // testing: echo -e '\e(0a\e(B'
    // The xterm output sometimes seems to conflict with the
    // reference above. xterm seems in line with the reference
    // when running vttest however.
    // The table below now uses xterm's output from vttest.
    SCLD: { // (0
      '`': '\u25c6', // '◆'
      'a': '\u2592', // '▒'
      'b': '\u0009', // '\t'
      'c': '\u000c', // '\f'
      'd': '\u000d', // '\r'
      'e': '\u000a', // '\n'
      'f': '\u00b0', // '°'
      'g': '\u00b1', // '±'
      'h': '\u2424', // '\u2424' (NL)
      'i': '\u000b', // '\v'
      'j': '\u2518', // '┘'
      'k': '\u2510', // '┐'
      'l': '\u250c', // '┌'
      'm': '\u2514', // '└'
      'n': '\u253c', // '┼'
      'o': '\u23ba', // '⎺'
      'p': '\u23bb', // '⎻'
      'q': '\u2500', // '─'
      'r': '\u23bc', // '⎼'
      's': '\u23bd', // '⎽'
      't': '\u251c', // '├'
      'u': '\u2524', // '┤'
      'v': '\u2534', // '┴'
      'w': '\u252c', // '┬'
      'x': '\u2502', // '│'
      'y': '\u2264', // '≤'
      'z': '\u2265', // '≥'
      '{': '\u03c0', // 'π'
      '|': '\u2260', // '≠'
      '}': '\u00a3', // '£'
      '~': '\u00b7'  // '·'
    },

    "UK": null, // (A
    "US": null, // (B (USASCII)
    "Dutch": null, // (4
    "Finnish": null, // (C or (5
    "French": null, // (R
    "FrenchCanadian": null, // (Q
    "German": null, // (K
    "Italian": null, // (Y
    "NorwegianDanish": null, // (E or (6
    "Spanish": null, // (Z
    "Swedish": null, // (H or (7
    "Swiss": null, // (=
    "ISOLatin": null // /A
  };
  
  /*************************************************************************/
  /**
   * EventEmitter
   */

  addListener(type: string, listener: EventListener): void {
    this._events[type] = this._events[type] || [];
    this._events[type].push(listener);
  }

  on(type: string, listener: EventListener): void {
    this.addListener(type, listener);
  }

  removeListener(type, listener) {
    if (!this._events[type]) return;

    var obj = this._events[type];
    var i = obj.length;

    while (i--) {
      if (obj[i] === listener /*  || obj[i].listener === listener */ )  {
        obj.splice(i, 1);
        return;
      }
    }
  }

  removeAllListeners(type) {
    if (this._events[type]) delete this._events[type];
  }

  // once(type, listener) {
  //   function on() {
  //     var args = Array.prototype.slice.call(arguments);
  //     this.removeListener(type, on);
  //     return listener.apply(this, args);
  //   }
  //   on.listener = listener;
  //   return this.on(type, on);
  // };

  emit(type, ...args: any[]) {
    if (!this._events[type]) return;

    var obj = this._events[type];
    var l = obj.length;
    var i = 0;

    for (; i < l; i++) {
      obj[i].apply(this, args);
    }
  }

  listeners(type) {
    return this._events[type] !== undefined ? this._events[type] : [];
  }
  /*************************************************************************/
  
}

/**
 * Helpers
 */

function on(el: EventTarget, type: string, handler: EventListener, capture = false): void {
  el.addEventListener(type, handler, capture);
}

function off(el: EventTarget, type: string, handler: EventListener, capture = false): void {
  el.removeEventListener(type, handler, capture || false);
}

function cancel(ev) {
  if (ev.preventDefault) ev.preventDefault();
  ev.returnValue = false;
  if (ev.stopPropagation) ev.stopPropagation();
  ev.cancelBubble = true;
  return false;
}

function inherits(child, parent) {
  function f() {
    this.constructor = child;
  }
  f.prototype = parent.prototype;
  child.prototype = new f;
}

// if bold is broken, we can't
// use it in the terminal.
function isBoldBroken(document) {
  var body = document.getElementsByTagName('body')[0];
  var el = document.createElement('span');
  el.innerHTML = 'hello world';
  body.appendChild(el);
  var w1 = el.scrollWidth;
  el.style.fontWeight = 'bold';
  var w2 = el.scrollWidth;
  body.removeChild(el);
  return w1 !== w2;
}

// var String = this.String;
// var setTimeout = this.setTimeout;
// var setInterval = this.setInterval;

function indexOf(obj, el) {
  var i = obj.length;
  while (i--) {
    if (obj[i] === el) return i;
  }
  return -1;
}

function isWide(ch) {
  if (ch <= '\uff00') return false;
  return (ch >= '\uff01' && ch <= '\uffbe') ||
      (ch >= '\uffc2' && ch <= '\uffc7') ||
      (ch >= '\uffca' && ch <= '\uffcf') ||
      (ch >= '\uffd2' && ch <= '\uffd7') ||
      (ch >= '\uffda' && ch <= '\uffdc') ||
      (ch >= '\uffe0' && ch <= '\uffe6') ||
      (ch >= '\uffe8' && ch <= '\uffee');
}

const matchColorCache = {};

function matchColor(r1, g1, b1) {
  var hash = (r1 << 16) | (g1 << 8) | b1;

  if (matchColorCache[hash] !== undefined) {
    return matchColorCache[hash];
  }

  var ldiff = Infinity;
  var li = -1;
  var i = 0;
  var c;
  var r2;
  var g2;
  var b2;
  var diff;

  for (; i < Terminal.vcolors.length; i++) {
    c = Terminal.vcolors[i];
    r2 = c[0];
    g2 = c[1];
    b2 = c[2];

    diff = matchColorDistance(r1, g1, b1, r2, g2, b2);

    if (diff === 0) {
      li = i;
      break;
    }

    if (diff < ldiff) {
      ldiff = diff;
      li = i;
    }
  }

  matchColorCache[hash] = li;
  return li;
}


// http://stackoverflow.com/questions/1633828
function matchColorDistance(r1, g1, b1, r2, g2, b2) {
  return Math.pow(30 * (r1 - r2), 2) +
    Math.pow(59 * (g1 - g2), 2) +
    Math.pow(11 * (b1 - b2), 2);
};
// 
// function each(obj, iter, con) {
//   if (obj.forEach) return obj.forEach(iter, con);
//   for (var i = 0; i < obj.length; i++) {
//     iter.call(con, obj[i], i, obj);
//   }
// }
// 
// function keys(obj) {
//   if (Object.keys) return Object.keys(obj);
//   var key, keys = [];
//   for (key in obj) {
//     if (Object.prototype.hasOwnProperty.call(obj, key)) {
//       keys.push(key);
//     }
//   }
//   return keys;
// }

export interface ScrollDetail {
  position: number;
  isBottom: boolean;
}