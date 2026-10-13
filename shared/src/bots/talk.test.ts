import { describe, expect, it } from 'vitest';
import { parse } from './talk.ts';

const players = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Bob' },
  { id: 3, name: 'Robo Carl' },
  { id: 4, name: 'Dee' },
];
const heard = (text: string, from = 1) => parse(text, from, players).heard;

describe('parse', () => {
  it('hears accusations, with the tell when one is named', () => {
    expect(heard('I saw Bob swap a brick!')).toEqual([{ kind: 'accuse', target: 2, deed: 'swap' }]);
    expect(heard('bob forged page 3')).toEqual([{ kind: 'accuse', target: 2, deed: 'forge' }]);
    expect(heard("it's carl")).toEqual([{ kind: 'accuse', target: 3 }]);
    expect(heard('Dee is sus')).toEqual([{ kind: 'accuse', target: 4 }]);
    expect(heard('ich glaube Bob ist der Saboteur')).toEqual([{ kind: 'accuse', target: 2 }]);
  });

  it('hears someone cleared, and votes', () => {
    expect(heard('Bob is innocent, he was with me')).toEqual([{ kind: 'clear', target: 2 }]);
    expect(heard('Bob is not the saboteur')).toEqual([{ kind: 'clear', target: 2 }]);
    expect(heard("don't trust Dee")).toEqual([{ kind: 'accuse', target: 4 }]);
    expect(heard('vote Dee')).toEqual([{ kind: 'vote', target: 4 }]);
    expect(heard('skip')).toEqual([{ kind: 'skip' }]);
  });

  it('never takes the speaker as the one they talk about', () => {
    expect(heard('Ada is innocent', 1)).toEqual([]);
  });

  it('knows who is spoken to', () => {
    expect(parse('Bob, where is page 5?', 1, players)).toEqual({
      to: 2,
      heard: [{ kind: 'page', step: 4 }],
    });
    expect(parse('@Dee I saw Bob hide a page', 1, players)).toEqual({
      to: 4,
      heard: [{ kind: 'accuse', target: 2, deed: 'hide' }],
    });
    expect(parse('Bob, you swapped that!', 1, players).heard).toEqual([
      { kind: 'accuse', target: 2, deed: 'swap' },
    ]);
  });

  it('hears questions and errands', () => {
    expect(heard('who do you think it is?')).toEqual([{ kind: 'ask', about: 'suspect' }]);
    expect(heard('wo ist seite 3B?')).toEqual([{ kind: 'page', step: 2, half: 'B' }]);
    expect(heard('which stamp is real?')).toEqual([{ kind: 'ask', about: 'stamp' }]);
    expect(heard('someone feed the dog')).toEqual([{ kind: 'errand', errand: 'dog' }]);
    expect(heard('can you fix the power')).toEqual([{ kind: 'errand', errand: 'panel' }]);
    expect(heard('Carl, come here')).toEqual([{ kind: 'errand', errand: 'come' }]);
    expect(heard('hello')).toEqual([{ kind: 'greet' }]);
    expect(heard('nice weather today')).toEqual([]);
  });
});
