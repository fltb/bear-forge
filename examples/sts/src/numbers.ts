/** C++ std::round rounds halfway cases away from zero (including sold-out shop prices). */
export function roundAway(value:number):number {return value<0?-Math.round(-value):Math.round(value);}
