// 2026-11-15 owner: secular inspirational quotes to help job seekers through the battle and the low days, left of the
// Job-Room entries button. Short, honest about it being hard, never preachy. Only well-attributed lines; proverbs say so.
// English only for now (translations when the owner says).
export const JOB_QUOTES: [string, string][] = [
  // 2026-11-15 owner: secular lines only (a religious person's secular quote is fine, e.g. Tutu), from humanitarians and
  // positive influences across walks of life - women, people of colour, LGBTQ+, disabled, Indigenous, many countries.
  ['You may encounter many defeats, but you must not be defeated.', 'Maya Angelou'],
  ['I can be changed by what happens to me. But I refuse to be reduced by it.', 'Maya Angelou'],
  ['Caring for myself is not self-indulgence, it is self-preservation.', 'Audre Lorde'],
  ['If they don\u2019t give you a seat at the table, bring a folding chair.', 'Shirley Chisholm'],
  ['The most common way people give up their power is by thinking they don\u2019t have any.', 'Alice Walker'],
  ['Hope is a discipline.', 'Mariame Kaba'],
  ['When the whole world is silent, even one voice becomes powerful.', 'Malala Yousafzai'],
  ['Never be limited by other people\u2019s limited imaginations.', 'Mae Jemison'],
  ['Not everything that is faced can be changed, but nothing can be changed until it is faced.', 'James Baldwin'],
  ['Hope will never be silent.', 'Harvey Milk'],
  ['However difficult life may seem, there is always something you can do and succeed at.', 'Stephen Hawking'],
  ['Although the world is full of suffering, it is also full of the overcoming of it.', 'Helen Keller'],
  ['I learned that courage was not the absence of fear, but the triumph over it.', 'Nelson Mandela'],
  ['Hope is being able to see that there is light despite all of the darkness.', 'Desmond Tutu'],
  ['We must accept finite disappointment, but never lose infinite hope.', 'Martin Luther King Jr.'],
  ['Real change, enduring change, happens one step at a time.', 'Ruth Bader Ginsburg'],
  ['No one can make you feel inferior without your consent.', 'Eleanor Roosevelt'],
  ['You gain strength, courage and confidence by every experience in which you really stop to look fear in the face.', 'Eleanor Roosevelt'],
  ['Nothing in life is to be feared, it is only to be understood.', 'Marie Curie'],
  ['In the midst of winter, I found there was, within me, an invincible summer.', 'Albert Camus'],
  ['When we are no longer able to change a situation, we are challenged to change ourselves.', 'Viktor Frankl'],
  ['Life shrinks or expands in proportion to one\u2019s courage.', 'Ana\u00efs Nin'],
  ['I am not afraid of storms, for I am learning how to sail my ship.', 'Louisa May Alcott'],
  ['The secret of our success is that we never, never give up.', 'Wilma Mankiller'],
  ['S\u00ed, se puede. Yes, it can be done.', 'Dolores Huerta'],
  ['Once the storm is over, you won\u2019t remember how you made it through. But you won\u2019t be the same person who walked in.', 'Haruki Murakami'],
  ['It takes courage and strength to be empathetic.', 'Jacinda Ardern'],
  ['If you want the rainbow, you gotta put up with the rain.', 'Dolly Parton'],
  ['Rock bottom became the solid foundation on which I rebuilt my life.', 'J.K. Rowling'],
  ['Start where you are. Use what you have. Do what you can.', 'Arthur Ashe'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['Courage doesn\u2019t always roar. Sometimes it\u2019s the quiet voice at the end of the day saying, I will try again tomorrow.', 'Mary Anne Radmacher'],
  ['Ever tried. Ever failed. No matter. Try again. Fail again. Fail better.', 'Samuel Beckett'],
  ['The best way out is always through.', 'Robert Frost'],
  ['Difficulties strengthen the mind, as labour does the body.', 'Seneca'],
  ['Our greatest glory is not in never falling, but in rising every time we fall.', 'Oliver Goldsmith'],
  ['There is no failure except in no longer trying.', 'Elbert Hubbard'],
  ['Perseverance is not a long race; it is many short races one after the other.', 'Walter Elliot'],
  ['It\u2019s not whether you get knocked down, it\u2019s whether you get up.', 'Vince Lombardi'],
  ['The darkest hour has only sixty minutes.', 'Morris Mandel'],
  // 2026-11-15 owner: Australian, Swiss and Scottish voices too
  ['To live is not merely to breathe; it is to act.', 'Jean-Jacques Rousseau'],
  ['The most beautiful people we have known are those who have known defeat, known suffering, known struggle, known loss, and have found their way out of the depths.', 'Elisabeth K\u00fcbler-Ross'],
  ['Life is like riding a bicycle. To keep your balance you must keep moving.', 'Albert Einstein'],
  ['The best laid schemes o\u2019 mice an\u2019 men gang aft agley.', 'Robert Burns'],
  ['A man\u2019s a man for a\u2019 that.', 'Robert Burns'],
  ['To travel hopefully is a better thing than to arrive.', 'Robert Louis Stevenson'],
  ['They tramp in mateship side by side.', 'Henry Lawson'],
  ['And he sees the vision splendid of the sunlit plains extended, and at night the wondrous glory of the everlasting stars.', 'Banjo Paterson'],
  ['Be micro-ambitious. Put your head down and work with pride on whatever is in front of you.', 'Tim Minchin'],
  ['Fall seven times, stand up eight.', 'Japanese proverb'],
  ['The bamboo that bends is stronger than the oak that resists.', 'Japanese proverb'],
  ['The one who moves a mountain begins by carrying away small stones.', 'Chinese proverb'],
  ['Little by little, one travels far.', 'Spanish proverb'],
  ['A smooth sea never made a skilled sailor.', 'English proverb'],
  ['Rest if you must, but don\u2019t you quit.', 'From the poem Don\u2019t Quit'],
]

const LAST_KEY = 'jobtrack_quote_last'

/** A different quote on every visit: random, never the one shown last time on this device. */
export function nextQuote(): [string, string] {
  let last = -1
  try { last = Number(localStorage.getItem(LAST_KEY) ?? -1) } catch { /* private mode */ }
  let i = Math.floor(Math.random() * JOB_QUOTES.length)
  if (i === last) i = (i + 1) % JOB_QUOTES.length
  try { localStorage.setItem(LAST_KEY, String(i)) } catch { /* private mode */ }
  return JOB_QUOTES[i]
}
