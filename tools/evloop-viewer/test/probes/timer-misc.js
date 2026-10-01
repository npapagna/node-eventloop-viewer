'use strict';

const t = setTimeout(function refreshed() { console.log('refreshed'); }, 5);
setTimeout(function doRefresh() { t.refresh(); }, 3);
const u = setTimeout(function unrefd() { console.log('unref never'); }, 100);
u.unref();
let n = 0;
const iv = setInterval(function tickIv() { if (++n === 3) clearInterval(iv); }, 2);
