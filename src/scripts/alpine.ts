import Alpine from 'alpinejs';
import { registerImageResize } from './image-resize';
import { registerImageCompress } from './image-compress';

// Both Alpine tool pages import this single shared module. Astro's ClientRouter
// only ever executes a hoisted module once, so registering the components here
// (rather than in each page's own deferred script) guarantees they are known to
// Alpine before any x-data node is initialised — including when a tool page is
// reached via an in-app View Transition, where the page's own script would
// otherwise run *after* Alpine's mutation observer has already bound the node
// to an empty scope (causing "handleDrop is not defined").
if (!(window as any).Alpine) {
  (window as any).Alpine = Alpine;
  registerImageResize(Alpine);
  registerImageCompress(Alpine);
  Alpine.start();
}
