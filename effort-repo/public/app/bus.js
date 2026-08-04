/* A one-line render bus.

   Controls need to trigger a re-render; render needs to sync controls. Wiring
   them to each other directly makes a module cycle, so both talk to this
   instead. main.js registers the real render once at boot. */

let renderFn = () => {};
let syncFn = () => {};

export function onRender(fn) { renderFn = fn; }
export function onSyncControls(fn) { syncFn = fn; }

export function requestRender() { renderFn(); }
export function syncControls() { syncFn(); }
