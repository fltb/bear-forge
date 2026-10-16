function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state, 1664525) + 1013904223 >>> 0;
    return state / 4294967296;
  };
}

export function bootstrap(values: number[], seed: number, repeats: number, tail: number): [number, number] {
  if (!values.length) throw Error('Empty bootstrap');
  const next = random(seed),
    samples: number[] = [];
  for (let b = 0; b < repeats; b++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(next() * values.length)]!;
    samples.push(sum / values.length);
  }
  samples.sort((a, b) => a - b);
  return [samples[Math.floor((samples.length - 1) * tail)]!, samples[Math.ceil((samples.length - 1) * (1 - tail))]!];
}
