The rule ports and constant tables in this module derive from gamerpuppy/sts_lightspeed, revision 7476a81954020087da31d41d16fddf475746ec2d.

MIT License

Copyright (c) 2021 gamerpuppy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The local differential reference now pins correction commit 3cea139e546bd8f8a21a2791e1c62b7266743d70 in ../sts_lightspeed (branch fix/rulebook-alignment). It corrects the documented game-rule defects and implements the six relic effects, nested reward continuations and safe card reward storage, nondestructive full-inventory potion handling and the initial Hungry Face chest charge; the upstream attribution and license remain unchanged. Existing Heart tapes retain their original acquisition revision in acquiredReference as historical data; execution and acceptance no longer read or replay them.
