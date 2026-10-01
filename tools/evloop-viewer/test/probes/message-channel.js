'use strict';

const { port1, port2 } = new MessageChannel();
port2.onmessage = function onmessage(e) { console.log('msg', e.data); port2.close(); };
port1.postMessage('hello');
