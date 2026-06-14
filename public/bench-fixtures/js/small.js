/**
 * small.js — Web utility module (~4 KB with whitespace/comments)
 * Used as a benchmark fixture for code-minifier.
 */

'use strict';

// ── String utilities ─────────────────────────────────────────────────────────

/**
 * Capitalise the first letter of a string.
 * @param {string} str
 * @returns {string}
 */
function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Truncate a string to maxLen characters, appending an ellipsis if needed.
 * @param {string} str
 * @param {number} maxLen
 * @param {string} [ellipsis='…']
 * @returns {string}
 */
function truncate(str, maxLen, ellipsis) {
  if (ellipsis === undefined) { ellipsis = '…'; }
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - ellipsis.length) + ellipsis;
}

/**
 * Convert camelCase or PascalCase to kebab-case.
 * @param {string} str
 * @returns {string}
 */
function toKebabCase(str) {
  return str
    .replace(/([A-Z])/g, function(match) { return '-' + match.toLowerCase(); })
    .replace(/^-/, '');
}

/**
 * Convert kebab-case or snake_case to camelCase.
 * @param {string} str
 * @returns {string}
 */
function toCamelCase(str) {
  return str.replace(/[-_]([a-z])/g, function(_, c) { return c.toUpperCase(); });
}

/**
 * Pad a string on the left to a given length.
 * @param {string} str
 * @param {number} len
 * @param {string} [char=' ']
 * @returns {string}
 */
function padStart(str, len, char) {
  if (char === undefined) { char = ' '; }
  str = String(str);
  while (str.length < len) str = char + str;
  return str;
}

// ── Number utilities ──────────────────────────────────────────────────────────

/**
 * Clamp a number between min and max.
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/**
 * Linear interpolation between a and b by factor t (0–1).
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Round a number to the given number of decimal places.
 * @param {number} n
 * @param {number} decimals
 * @returns {number}
 */
function roundTo(n, decimals) {
  var factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

/**
 * Format bytes as a human-readable string (B, KB, MB, GB).
 * @param {number} bytes
 * @returns {string}
 */
function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

// ── DOM utilities ─────────────────────────────────────────────────────────────

/**
 * Query a single element, throwing if not found.
 * @param {string} selector
 * @param {Element} [root=document]
 * @returns {Element}
 */
function qs(selector, root) {
  var el = (root || document).querySelector(selector);
  if (!el) throw new Error('Element not found: ' + selector);
  return el;
}

/**
 * Query all matching elements as an Array.
 * @param {string} selector
 * @param {Element} [root=document]
 * @returns {Element[]}
 */
function qsa(selector, root) {
  return Array.from((root || document).querySelectorAll(selector));
}

/**
 * Add an event listener and return a cleanup function.
 * @param {EventTarget} target
 * @param {string} event
 * @param {EventListenerOrEventListenerObject} handler
 * @returns {function(): void}
 */
function on(target, event, handler) {
  target.addEventListener(event, handler);
  return function() { target.removeEventListener(event, handler); };
}

/**
 * Copy text to the clipboard. Returns a Promise.
 * @param {string} text
 * @returns {Promise<void>}
 */
function copyText(text) {
  return navigator.clipboard.writeText(text);
}

// ── Array utilities ───────────────────────────────────────────────────────────

/**
 * Return a new array with duplicate values removed.
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
function unique(arr) {
  return Array.from(new Set(arr));
}

/**
 * Group an array of objects by a key.
 * @template T
 * @param {T[]} arr
 * @param {keyof T} key
 * @returns {Record<string, T[]>}
 */
function groupBy(arr, key) {
  return arr.reduce(function(acc, item) {
    var k = String(item[key]);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

/**
 * Chunk an array into sub-arrays of the given size.
 * @template T
 * @param {T[]} arr
 * @param {number} size
 * @returns {T[][]}
 */
function chunk(arr, size) {
  var result = [];
  for (var i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// Exports for module environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    capitalize, truncate, toKebabCase, toCamelCase, padStart,
    clamp, lerp, roundTo, fmtBytes,
    qs, qsa, on, copyText,
    unique, groupBy, chunk,
  };
}
