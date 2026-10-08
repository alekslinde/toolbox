import Alpine from 'alpinejs';
import { registerImageResize } from './image-resize';

// The resize tool imports this single shared module. Astro's ClientRouter only
// ever executes a hoisted module once, so registering the component here
// (rather than in the page's own deferred script) guarantees it is known to
// Alpine before any x-data node is initialised — including when the page is
// reached via an in-app View Transition, where the page's own script would
// otherwise run *after* Alpine's mutation observer has already bound the node
// to an empty scope (causing "handleDrop is not defined").
//
// Tools migrated to declared ops (see src/lib/ops/) use plain DOM wiring and do
// not appear here.
if (!(window as any).Alpine) {
  (window as any).Alpine = Alpine;
  registerImageResize(Alpine);
  Alpine.start();
}
