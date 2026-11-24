// Vercel Function: every /api/* request is rewritten here (vercel.json).
// The TypeScript source is compiled to dist/ by the build command first.
import { createVercelApp } from '../dist/vercel.js';

export default createVercelApp();
