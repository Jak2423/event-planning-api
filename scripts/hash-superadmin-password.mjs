#!/usr/bin/env node
import bcrypt from 'bcryptjs';

const plain = process.argv[2];
if (!plain || plain.length < 8) {
	console.error('Usage: node scripts/hash-superadmin-password.mjs "<password-at-least-8-chars>"');
	process.exit(1);
}
console.log(bcrypt.hashSync(plain, 12));
