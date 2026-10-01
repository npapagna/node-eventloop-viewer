function wait(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
async function main(): Promise<void> { await wait(1); console.log('ts done'); }
main();
