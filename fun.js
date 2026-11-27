'use strict';

/**
 * FUN MENU — 17 commands.
 *
 * Content is local (no API needed) except .news and .gif, which fetch live
 * data. Everything is randomised so repeated calls feel different.
 */

const { rand, randInt, hash32, num } = require('../lib/util');
const media = require('../lib/media');

const JOKES = [
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "A SQL query walks into a bar, walks up to two tables and asks: 'Can I join you?'",
  "Why did the developer go broke? Because he used up all his cache.",
  "There are 10 types of people: those who understand binary and those who don't.",
  "I told my computer I needed a break. It said: 'No problem, I'll go to sleep.'",
  "Why do Java developers wear glasses? Because they don't C#.",
  "A programmer's wife tells him: 'Go to the store and buy a loaf of bread. If they have eggs, buy a dozen.' He came back with 12 loaves of bread.",
  "Debugging: being the detective in a crime movie where you are also the murderer.",
  "Why was the JavaScript developer sad? Because he didn't know how to 'null' his feelings.",
  "My code doesn't have bugs, it just develops random features.",
  "What's the object-oriented way to become wealthy? Inheritance.",
  "Why did the function stop calling? It lost its arguments.",
  "Two bytes meet. The first says: 'Are you ill?' The second replies: 'Yeah, I have a parity error.'",
  "A QA engineer walks into a bar. Orders 1 beer. Orders 0 beers. Orders 999999999 beers. Orders a lizard. Orders -1 beers. Orders a sfdeljknesv.",
  "Why do Python programmers prefer snakes? Because they don't bite when you indent correctly.",
];

const FACTS = [
  "Honey never spoils. Archaeologists have found 3,000-year-old honey that is still edible.",
  "Octopuses have three hearts and blue blood.",
  "A day on Venus is longer than a year on Venus.",
  "Bananas are berries, but strawberries are not.",
  "The Eiffel Tower grows about 15 cm taller in summer because the iron expands.",
  "Sharks existed before trees. Sharks are roughly 450 million years old; trees about 385 million.",
  "There are more possible chess games than atoms in the observable universe.",
  "Wombat droppings are cube-shaped.",
  "The human nose can distinguish over one trillion different scents.",
  "Lightning strikes the Earth about 8 million times a day.",
  "A single cloud can weigh more than a million kilograms.",
  "Sea otters hold hands while sleeping so they don't drift apart.",
  "The first computer bug was a literal moth, found in a Harvard Mark II in 1947.",
  "Your brain uses about 20% of your body's total energy.",
  "There is enough DNA in your body to stretch from the Sun to Pluto and back — 17 times.",
];

const QUOTES = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Talk is cheap. Show me the code.", author: "Linus Torvalds" },
  { text: "Programs must be written for people to read, and only incidentally for machines to execute.", author: "Harold Abelson" },
  { text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Premature optimization is the root of all evil.", author: "Donald Knuth" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese proverb" },
  { text: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.", author: "Martin Fowler" },
  { text: "First, solve the problem. Then, write the code.", author: "John Johnson" },
  { text: "Experience is the name everyone gives to their mistakes.", author: "Oscar Wilde" },
  { text: "Code is like humour. When you have to explain it, it's bad.", author: "Cory House" },
  { text: "The journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
  { text: "Make it work, make it right, make it fast.", author: "Kent Beck" },
  { text: "Knowledge is power.", author: "Francis Bacon" },
  { text: "Stay hungry, stay foolish.", author: "Stewart Brand" },
];

const TRUTHS = [
  "What's the most embarrassing thing you've searched online?",
  "Who in this chat would you trust with your phone unlocked?",
  "What's a lie you told that you still feel guilty about?",
  "What's the last thing you deleted from your phone?",
  "Have you ever pretended to be busy to avoid someone here?",
  "What's your most useless talent?",
  "What's the biggest mistake you made this year?",
  "Who was your first crush?",
  "What's something you've never told anyone in this group?",
  "Have you ever cried at a movie? Which one?",
  "What's the pettiest reason you've stopped talking to someone?",
  "What's the most money you've spent on something stupid?",
];

const DARES = [
  "Send the last photo in your gallery to this chat.",
  "Type your name with your eyes closed.",
  "Send a voice note singing the first song that comes to mind.",
  "Change your WhatsApp status to 'I lost a dare' for one hour.",
  "Message the 5th person in your chat list and say 'I was thinking about you'.",
  "Send a selfie right now, no filters.",
  "Speak only in emojis for the next 10 messages.",
  "Call a contact and say 'wrong number' then hang up.",
  "Post the last thing you copied to your clipboard.",
  "Send a voice note in an accent you can't do.",
  "Text your crush 'hey' and screenshot the reply.",
  "Do 20 push-ups and send a voice note counting them.",
];

const COMPLIMENTS = [
  "You have a laugh that makes rooms lighter.",
  "You're the kind of person people remember after one conversation.",
  "Your taste is genuinely excellent — and you know it.",
  "You make hard things look easy, which is a rare skill.",
  "You're smarter than you give yourself credit for.",
  "Your energy is contagious in the best way.",
  "You notice things other people miss.",
  "You're the friend everyone wishes they had.",
  "You have a way of making people feel heard.",
  "You're doing better than you think you are.",
];

const FLIRTS = [
  "Are you a Wi-Fi signal? Because I'm feeling a strong connection.",
  "Do you have a map? I keep getting lost in your eyes.",
  "Are you a magician? Because whenever I look at you, everyone else disappears.",
  "If you were a vegetable, you'd be a cute-cumber.",
  "Are you a parking ticket? Because you've got FINE written all over you.",
  "Do you believe in love at first sight, or should I message you again?",
  "Are you a time traveller? Because I see you in my future.",
  "Is your name Google? Because you're everything I've been searching for.",
  "Are you a loan? Because you've got my interest.",
  "If I could rearrange the alphabet, I'd put U and I together.",
];

const ROSEDAY = [
  "🌹 A rose for you — because someone as kind as you deserves flowers every day.",
  "🌹 Roses are red, violets are blue, this chat got brighter the day you came through.",
  "🌹 Here's a rose that never wilts. Like good friends, it just keeps going.",
  "🌹 You bring the kind of calm that makes everything feel okay. Have a rose.",
  "🌹 Some people are sunshine. You're the whole garden. 🌹",
];

const GOODNIGHTS = [
  "🌙 Goodnight. Put the phone down, the bugs will still be there tomorrow.",
  "🌙 Sleep well — your brain does its best debugging while you're unconscious.",
  "🌙 Goodnight. May your dreams compile on the first try.",
  "🌙 Rest now. Tomorrow's problems are tomorrow's problems.",
  "🌙 Goodnight. Close the laptop. The server will survive without you for eight hours.",
];

const VALENTINE = [
  "💌 Roses are red, my code is a mess, but you make me want to write fewer comments and more feelings.",
  "💌 You're the semicolon to my statement — small, but everything falls apart without you.",
  "💌 If I had to choose between you and a stable internet connection… I'd choose you. Reluctantly.",
  "💌 You had me at 'hello world'.",
  "💌 My heart has no rate limit when it comes to you.",
];

const CHARACTERS = [
  { name: 'The Architect', desc: 'You plan everything before you start. Your friends call it overthinking; you call it engineering.' },
  { name: 'The Firefighter', desc: 'You thrive in chaos. Production is down? Good. Finally, something interesting.' },
  { name: 'The Perfectionist', desc: 'You will refactor a working function because the variable names are wrong. You are right, and it is exhausting.' },
  { name: 'The Ghost', desc: 'You read every message and reply to none. Your read receipts are the only proof you exist.' },
  { name: 'The Optimist', desc: 'It will work on the first try. It never works on the first try. You are undeterred.' },
  { name: 'The Minimalist', desc: 'You deleted 400 lines and the feature still works. You are insufferable about it.' },
  { name: 'The Night Owl', desc: 'Your best ideas arrive at 2am. Your best decisions do not.' },
  { name: 'The Diplomat', desc: 'You can say "that is a terrible idea" in a way that makes people thank you.' },
];

const STUPID_NAMES = [
  'Certified Bug Creator', 'Professional Undo User', 'Stack Overflow Copy-Paster',
  'Semicolon Enthusiast', 'Merge Conflict Survivor', 'Localhost Legend',
  'Regex Whisperer', 'Off-By-One Specialist', 'Rubber Duck Therapist',
  'Infinite Loop Inspector', 'Null Pointer Apologist', 'Cache Invalidator',
];

const TRIVIA = [
  { q: 'What does "HTTP" stand for?', a: 'HyperText Transfer Protocol' },
  { q: 'Which company created JavaScript?', a: 'Netscape' },
  { q: 'What year was the first iPhone released?', a: '2007' },
  { q: 'What does "CPU" stand for?', a: 'Central Processing Unit' },
  { q: 'Which language is known as the "language of the web"?', a: 'JavaScript' },
  { q: 'What does "RAM" stand for?', a: 'Random Access Memory' },
  { q: 'Who is considered the first computer programmer?', a: 'Ada Lovelace' },
  { q: 'What does "SQL" stand for?', a: 'Structured Query Language' },
  { q: 'Which country has the most time zones?', a: 'France' },
  { q: 'What is the largest planet in our solar system?', a: 'Jupiter' },
  { q: 'How many bits are in a byte?', a: '8' },
  { q: 'What does "GPU" stand for?', a: 'Graphics Processing Unit' },
];

const NEWS_FEEDS = [
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.bbci.co.uk/news/technology/rss.xml',
];

/** Pull <title> and <link> pairs out of an RSS document. */
function parseRss(xml) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/).slice(1);
  for (const block of blocks) {
    const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1];
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1];
    const date = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
    if (title) {
      items.push({
        title: title.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(),
        link: (link || '').trim(),
        date: date ? new Date(date).toLocaleString() : '',
      });
    }
  }
  return items;
}

const commands = {
  async blague(ctx) {
    await ctx.reply(`😂 *Joke*\n\n${rand(JOKES)}`);
  },

  async fact(ctx) {
    await ctx.reply(`🧠 *Did you know?*\n\n${rand(FACTS)}`);
  },

  async quote(ctx) {
    const q = rand(QUOTES);
    await ctx.reply(`💬 _"${q.text}"_\n\n— *${q.author}*`);
  },

  async truth(ctx) {
    await ctx.reply(`🫣 *Truth*\n\n${rand(TRUTHS)}`);
  },

  async dare(ctx) {
    await ctx.reply(`🔥 *Dare*\n\n${rand(DARES)}`);
  },

  async compliment(ctx) {
    const target = ctx.mentioned[0] || ctx.quoted?.sender;
    const line = rand(COMPLIMENTS);
    if (target) {
      await ctx.reply(`💐 @${num(target)}\n\n${line}`, { mentions: [target] });
    } else {
      await ctx.reply(`💐 ${line}`);
    }
  },

  async flirt(ctx) {
    const target = ctx.mentioned[0] || ctx.quoted?.sender;
    const line = rand(FLIRTS);
    if (target) {
      await ctx.reply(`😘 @${num(target)}\n\n${line}`, { mentions: [target] });
    } else {
      await ctx.reply(`😘 ${line}`);
    }
  },

  async roseday(ctx) {
    const target = ctx.mentioned[0] || ctx.quoted?.sender;
    const line = rand(ROSEDAY);
    if (target) {
      await ctx.reply(`@${num(target)}\n\n${line}`, { mentions: [target] });
    } else {
      await ctx.reply(line);
    }
  },

  async goodnight(ctx) {
    await ctx.reply(rand(GOODNIGHTS));
  },

  async valentine(ctx) {
    const target = ctx.mentioned[0] || ctx.quoted?.sender;
    const line = rand(VALENTINE);
    if (target) {
      await ctx.reply(`@${num(target)}\n\n${line}`, { mentions: [target] });
    } else {
      await ctx.reply(line);
    }
  },

  async character(ctx) {
    const c = rand(CHARACTERS);
    await ctx.reply(`🎭 *Your character: ${c.name}*\n\n${c.desc}`);
  },

  async stupid(ctx) {
    const name = rand(STUPID_NAMES);
    const target = ctx.mentioned[0] || ctx.quoted?.sender;
    if (target) {
      await ctx.reply(`🏷️ @${num(target)} is a *${name}*.`, { mentions: [target] });
    } else {
      await ctx.reply(`🏷️ You are a *${name}*.`);
    }
  },

  async ship(ctx) {
    const a = ctx.mentioned[0] || ctx.senderJid;
    const b = ctx.mentioned[1] || (ctx.quoted?.sender ?? null);

    if (!b) {
      throw new Error('Mention two people: .ship @person1 @person2');
    }

    // Deterministic: the same pair always gets the same score.
    const key = [num(a), num(b)].sort().join('-');
    const score = (hash32(key) % 101);
    const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));

    let verdict;
    if (score >= 90) verdict = 'Soulmates. Genuinely.';
    else if (score >= 70) verdict = 'Strong match — someone should say something.';
    else if (score >= 50) verdict = 'There is something there.';
    else if (score >= 30) verdict = 'Friends, probably.';
    else if (score >= 10) verdict = 'Awkward silence material.';
    else verdict = 'Absolutely not. Run.';

    await ctx.reply(
      `💘 *Ship meter*\n\n` +
      `@${num(a)}  ❤️  @${num(b)}\n\n` +
      `${bar}  *${score}%*\n\n_${verdict}_`,
      { mentions: [a, b] }
    );
  },

  async trivia(ctx) {
    const t = rand(TRIVIA);
    await ctx.reply(
      `❓ *Trivia*\n\n${t.q}\n\n_Answer is posted after 15 seconds._`
    );
    // Send the answer on a timer so it isn't spoiled instantly.
    const timer = setTimeout(() => {
      ctx.send(ctx.chatJid, { text: `✅ *Answer:* ${t.a}` }).catch(() => {});
    }, 15000);
    if (timer.unref) timer.unref();
  },

  async news(ctx) {
    const feed = rand(NEWS_FEEDS);
    const xml = await media.fetchHtml(feed);
    const items = parseRss(xml).slice(0, 6);
    if (!items.length) throw new Error('Could not read the news feed right now.');

    const body = items.map((it, i) =>
      `*${i + 1}. ${it.title}*\n${it.link}`
    ).join('\n\n');

    await ctx.reply(`📰 *Latest news*\n\n${body}`);
  },

  async gif(ctx) {
    const query = ctx.text.trim() || 'funny';
    await ctx.react('⏳');
    const buf = await media.searchImage(query, { animated: true });
    await ctx.send(ctx.chatJid, {
      video: buf,
      gifPlayback: true,
      caption: `🎞️ ${query}`,
    }, { quoted: ctx.msg });
  },

  async meme(ctx) {
    const res = await require('../lib/util').get('https://meme-api.com/gimme', { timeout: 20000 });
    const m = res.data;
    if (!m?.url) throw new Error('Could not fetch a meme right now.');

    const buf = await media.fetchImage(m.url);
    await ctx.send(ctx.chatJid, { image: buf, caption: `😂 ${m.title || ''}\n_r/${m.subreddit || 'memes'}_` }, { quoted: ctx.msg });
  },
};

module.exports = { category: 'FUN', commands };
