/**
 * medium.js — Larger utility library (~16 KB with whitespace/comments)
 * Used as a benchmark fixture for the code minifier.
 *
 * Covers: DOM manipulation, event handling, async utilities, state management,
 * data transforms, colour utilities, and a small reactive store implementation.
 */

'use strict';

// ── String utilities ──────────────────────────────────────────────────────────

/**
 * Capitalise the first letter of a string.
 */
function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Truncate a string to maxLen characters.
 */
function truncate(str, maxLen, ellipsis) {
  if (ellipsis === undefined) { ellipsis = '…'; }
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - ellipsis.length) + ellipsis;
}

/**
 * Convert camelCase or PascalCase to kebab-case.
 */
function toKebabCase(str) {
  return str
    .replace(/([A-Z])/g, function(m) { return '-' + m.toLowerCase(); })
    .replace(/^-/, '');
}

/**
 * Convert kebab-case or snake_case to camelCase.
 */
function toCamelCase(str) {
  return str.replace(/[-_]([a-z])/g, function(_, c) { return c.toUpperCase(); });
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHTML(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

/**
 * Strip all HTML tags from a string, returning plain text.
 */
function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Pad a string on the left to a given length using a fill character.
 */
function padStart(str, len, char) {
  str = String(str);
  char = char || ' ';
  while (str.length < len) str = char + str;
  return str;
}

/**
 * Pad a string on the right to a given length using a fill character.
 */
function padEnd(str, len, char) {
  str = String(str);
  char = char || ' ';
  while (str.length < len) str = str + char;
  return str;
}

/**
 * Count occurrences of a substring within a string.
 */
function countOccurrences(str, sub) {
  if (!sub) return 0;
  var count = 0;
  var pos = str.indexOf(sub);
  while (pos !== -1) {
    count++;
    pos = str.indexOf(sub, pos + sub.length);
  }
  return count;
}

/**
 * Split a string into lines, trimming trailing whitespace from each.
 */
function splitLines(str) {
  return str.split('\n').map(function(l) { return l.trimEnd(); });
}

// ── Number utilities ──────────────────────────────────────────────────────────

/**
 * Clamp a number between min and max.
 */
function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/**
 * Linear interpolation between a and b by factor t (0–1).
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Map a value from one range to another.
 */
function mapRange(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/**
 * Round n to the given number of decimal places.
 */
function roundTo(n, decimals) {
  var factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

/**
 * Return a pseudo-random integer in [min, max] (inclusive).
 */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Format a number of bytes as a human-readable string.
 */
function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

/**
 * Format a duration in milliseconds as a human-readable string.
 */
function fmtDuration(ms) {
  if (ms < 1000) return ms + ' ms';
  var s = ms / 1000;
  if (s < 60) return s.toFixed(1) + ' s';
  var m = Math.floor(s / 60);
  var rem = Math.round(s % 60);
  return m + 'm ' + rem + 's';
}

/**
 * Format a number with thousand separators.
 */
function fmtNumber(n, locale) {
  return n.toLocaleString(locale || 'en-US');
}

// ── Array utilities ───────────────────────────────────────────────────────────

/**
 * Remove duplicate values from an array (uses Set equality).
 */
function unique(arr) {
  return Array.from(new Set(arr));
}

/**
 * Group an array of objects by a key function or property name.
 */
function groupBy(arr, keyFn) {
  var fn = typeof keyFn === 'function' ? keyFn : function(item) { return item[keyFn]; };
  return arr.reduce(function(acc, item) {
    var k = String(fn(item));
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

/**
 * Chunk an array into sub-arrays of the given size.
 */
function chunk(arr, size) {
  var result = [];
  for (var i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Flatten a nested array one level deep.
 */
function flatten(arr) {
  return arr.reduce(function(acc, val) {
    return acc.concat(Array.isArray(val) ? val : [val]);
  }, []);
}

/**
 * Return the intersection of two arrays.
 */
function intersect(a, b) {
  var setB = new Set(b);
  return a.filter(function(x) { return setB.has(x); });
}

/**
 * Return the difference of two arrays (elements in a not in b).
 */
function difference(a, b) {
  var setB = new Set(b);
  return a.filter(function(x) { return !setB.has(x); });
}

/**
 * Return a shuffled copy of the array (Fisher-Yates).
 */
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/**
 * Sort an array of objects by a key, with optional direction.
 */
function sortBy(arr, key, dir) {
  var d = dir === 'desc' ? -1 : 1;
  return arr.slice().sort(function(a, b) {
    var va = a[key], vb = b[key];
    if (va < vb) return -d;
    if (va > vb) return d;
    return 0;
  });
}

// ── Object utilities ──────────────────────────────────────────────────────────

/**
 * Deep merge multiple objects into a new object.
 */
function deepMerge() {
  var result = {};
  for (var i = 0; i < arguments.length; i++) {
    var obj = arguments[i];
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      var val = obj[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        result[key] = deepMerge(result[key] || {}, val);
      } else {
        result[key] = val;
      }
    }
  }
  return result;
}

/**
 * Pick a subset of keys from an object.
 */
function pick(obj, keys) {
  var result = {};
  keys.forEach(function(k) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) result[k] = obj[k];
  });
  return result;
}

/**
 * Omit a subset of keys from an object.
 */
function omit(obj, keys) {
  var keySet = new Set(keys);
  var result = {};
  for (var k in obj) {
    if (!keySet.has(k)) result[k] = obj[k];
  }
  return result;
}

/**
 * Check if an object is empty (no own enumerable properties).
 */
function isEmpty(obj) {
  return Object.keys(obj).length === 0;
}

// ── DOM utilities ─────────────────────────────────────────────────────────────

/**
 * Query a single element; throw if not found.
 */
function qs(selector, root) {
  var el = (root || document).querySelector(selector);
  if (!el) throw new Error('Element not found: ' + selector);
  return el;
}

/**
 * Query all matching elements as an Array.
 */
function qsa(selector, root) {
  return Array.from((root || document).querySelectorAll(selector));
}

/**
 * Create an element with optional attributes and children.
 */
function el(tag, attrs, children) {
  var node = document.createElement(tag);
  if (attrs) {
    for (var k in attrs) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
  }
  if (children) {
    children.forEach(function(child) {
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    });
  }
  return node;
}

/**
 * Add an event listener and return a cleanup function.
 */
function on(target, event, handler, options) {
  target.addEventListener(event, handler, options);
  return function() { target.removeEventListener(event, handler, options); };
}

/**
 * Delegate an event from a parent to matching child elements.
 */
function delegate(parent, selector, event, handler) {
  return on(parent, event, function(e) {
    var target = e.target.closest(selector);
    if (target && parent.contains(target)) handler.call(target, e, target);
  });
}

/**
 * Copy text to the clipboard using the Clipboard API.
 */
function copyText(text) {
  return navigator.clipboard.writeText(text);
}

/**
 * Set multiple CSS custom properties on an element.
 */
function setCSSVars(el, vars) {
  for (var k in vars) {
    el.style.setProperty('--' + k, vars[k]);
  }
}

// ── Async utilities ───────────────────────────────────────────────────────────

/**
 * Return a Promise that resolves after ms milliseconds.
 */
function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

/**
 * Debounce a function: only invoke it after `wait` ms of no calls.
 */
function debounce(fn, wait) {
  var timer;
  return function() {
    var args = arguments;
    var ctx = this;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, wait);
  };
}

/**
 * Throttle a function: invoke at most once per `wait` ms.
 */
function throttle(fn, wait) {
  var last = 0;
  return function() {
    var now = Date.now();
    if (now - last >= wait) {
      last = now;
      return fn.apply(this, arguments);
    }
  };
}

/**
 * Retry an async function up to maxAttempts times with exponential back-off.
 */
function retry(fn, maxAttempts, baseDelay) {
  baseDelay = baseDelay || 200;
  return fn().catch(function err(e) {
    if (maxAttempts <= 1) throw e;
    return sleep(baseDelay).then(function() {
      return retry(fn, maxAttempts - 1, baseDelay * 2);
    });
  });
}

/**
 * Run async tasks concurrently, limiting parallelism to `limit`.
 */
function pLimit(tasks, limit) {
  var results = new Array(tasks.length);
  var running = 0;
  var index = 0;
  return new Promise(function(resolve, reject) {
    function next() {
      if (index === tasks.length && running === 0) { resolve(results); return; }
      while (running < limit && index < tasks.length) {
        (function(i) {
          running++;
          Promise.resolve().then(function() { return tasks[i](); }).then(function(val) {
            results[i] = val;
            running--;
            next();
          }).catch(reject);
        })(index++);
      }
    }
    next();
  });
}

// ── Colour utilities ──────────────────────────────────────────────────────────

/**
 * Parse a CSS hex colour string (#rgb or #rrggbb) to {r, g, b}.
 */
function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex[0]+hex[0] + hex[1]+hex[1] + hex[2]+hex[2];
  var n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Convert {r, g, b} (0–255) to a CSS hex string.
 */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(function(c) {
    return clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0');
  }).join('');
}

/**
 * Compute the relative luminance of an RGB colour (WCAG 2.1).
 */
function luminance(r, g, b) {
  function lin(c) {
    var v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Compute the WCAG contrast ratio between two hex colours.
 */
function contrastRatio(hex1, hex2) {
  var c1 = hexToRgb(hex1), c2 = hexToRgb(hex2);
  var l1 = luminance(c1.r, c1.g, c1.b);
  var l2 = luminance(c2.r, c2.g, c2.b);
  var lighter = Math.max(l1, l2);
  var darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Mix two hex colours by a weight (0 = all a, 1 = all b).
 */
function mixColours(hexA, hexB, weight) {
  var a = hexToRgb(hexA), b = hexToRgb(hexB);
  weight = clamp(weight, 0, 1);
  return rgbToHex(
    lerp(a.r, b.r, weight),
    lerp(a.g, b.g, weight),
    lerp(a.b, b.b, weight)
  );
}

// ── Tiny reactive store ───────────────────────────────────────────────────────

/**
 * Create a tiny reactive store.
 *
 * @template T
 * @param {T} initialState
 * @returns {{ get: () => T, set: (next: T | ((prev: T) => T)) => void, subscribe: (fn: (state: T) => void) => () => void }}
 */
function createStore(initialState) {
  var state = initialState;
  var subscribers = [];

  function get() { return state; }

  function set(next) {
    var nextState = typeof next === 'function' ? next(state) : next;
    if (nextState === state) return;
    state = nextState;
    subscribers.forEach(function(fn) { fn(state); });
  }

  function subscribe(fn) {
    subscribers.push(fn);
    fn(state);  // immediate call with current state
    return function() {
      var idx = subscribers.indexOf(fn);
      if (idx !== -1) subscribers.splice(idx, 1);
    };
  }

  return { get: get, set: set, subscribe: subscribe };
}

// ── LocalStorage utilities ────────────────────────────────────────────────────

/**
 * Get a JSON-parsed value from localStorage, or a default if missing/invalid.
 */
function lsGet(key, defaultValue) {
  try {
    var raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : defaultValue;
  } catch (_) {
    return defaultValue;
  }
}

/**
 * Serialise a value to JSON and store it in localStorage.
 * Returns false if storage is unavailable or full.
 */
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Remove a key from localStorage.
 */
function lsRemove(key) {
  try { localStorage.removeItem(key); } catch (_) {}
}

// ── File utilities ────────────────────────────────────────────────────────────

/**
 * Read a File as a text string.
 */
function readFileText(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.onerror = function() { reject(reader.error); };
    reader.readAsText(file);
  });
}

/**
 * Read a File as an ArrayBuffer.
 */
function readFileBuffer(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.onerror = function() { reject(reader.error); };
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Read a File as a data URL.
 */
function readFileDataURL(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.onerror = function() { reject(reader.error); };
    reader.readAsDataURL(file);
  });
}

/**
 * Trigger a file download for a Blob.
 */
function downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
}

/**
 * Extract the base filename (no extension) from a full file name.
 */
function baseName(name) {
  return name.replace(/\.[^.]+$/, '');
}

/**
 * Extract the extension (lowercase, no dot) from a file name.
 */
function extOf(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

// ── Exports ───────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // strings
    capitalize, truncate, toKebabCase, toCamelCase,
    escapeHTML, stripTags, padStart, padEnd, countOccurrences, splitLines,
    // numbers
    clamp, lerp, mapRange, roundTo, randInt, fmtBytes, fmtDuration, fmtNumber,
    // arrays
    unique, groupBy, chunk, flatten, intersect, difference, shuffle, sortBy,
    // objects
    deepMerge, pick, omit, isEmpty,
    // DOM
    qs, qsa, el, on, delegate, copyText, setCSSVars,
    // async
    sleep, debounce, throttle, retry, pLimit,
    // colour
    hexToRgb, rgbToHex, luminance, contrastRatio, mixColours,
    // store
    createStore,
    // storage
    lsGet, lsSet, lsRemove,
    // files
    readFileText, readFileBuffer, readFileDataURL, downloadBlob, baseName, extOf,
  };
}
