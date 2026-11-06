// Original wrapper logic. Addresses audited for the PAL SLES-02194 release.
export function unlockPal(ram) {
  const view = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
  const word = address => view.getUint32(address & 0x1fffff, true);
  const half = (address, value) => view.setUint16(address & 0x1fffff, value, true);
  const frontend = word(0x800c3ca0);
  if ((frontend !== 1 && frontend !== 2) || word(0x800d6980) !== 0) return false;
  if (view.getUint16(0xc2ec0, true) === 8 && view.getUint16(0xc2ec2, true) === 6 &&
      [0xc2ec4, 0xc2ec6, 0xc2eca, 0xc2ecc].every(address => view.getUint16(address, true) === 1) &&
      ram.subarray(0xd7438, 0xd7470).every(value => value === 2)) return false;
  for (let rider = 0; rider < 8; rider++) {
    ram[0xe3b48 + rider * 2] = 5; ram[0xe3b49 + rider * 2] = 4;
    ram.fill(2, 0xd7438 + rider * 7, 0xd7438 + (rider + 1) * 7);
    ram[0xd6ae8 + rider * 2] = (rider + 1) % 8;
    ram[0xd6ae9 + rider * 2] = (rider + 7) % 8;
  }
  for (const address of [0xc2ebc, 0xc2ebe, 0xc2ec4, 0xc2ec6, 0xc2eca, 0xc2ecc]) half(address, 1);
  half(0xc2ec0, 8); half(0xc2ec2, 6);
  for (let course = 0; course < 15; course++) {
    ram[0xd6af8 + course * 2] = (course + 1) % 15;
    ram[0xd6af9 + course * 2] = (course + 14) % 15;
  }
  return true;
}
