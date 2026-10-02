// Builds data/data.json with the starter cast, downloading each photo from Wikipedia.
// Run once:  node seed.js   (overwrites data/data.json)
const fs = require('fs');
const path = require('path');
const { wikiLookup, downloadImage } = require('./server.js');

const people = [
  ['jane-goodall', 'Jane Goodall', 'Primatologist & Conservationist', 'Jane Goodall'],
  ['anthony-fauci', 'Anthony Fauci', 'Physician-Scientist', 'Anthony Fauci'],
  ['malala', 'Malala Yousafzai', 'Education Activist', 'Malala Yousafzai'],
  ['mlk', 'Martin Luther King Jr.', 'Civil Rights Leader', 'Martin Luther King Jr.'],
  ['marie-curie', 'Marie Curie', 'Physicist & Chemist', 'Marie Curie'],
  ['muhammad-ali', 'Muhammad Ali', 'Professional Boxer', 'Muhammad Ali'],
  ['steve-jobs', 'Steve Jobs', 'Technology Entrepreneur', 'Steve Jobs'],
  ['greta', 'Greta Thunberg', 'Climate Activist', 'Greta Thunberg'],
  ['einstein', 'Albert Einstein', 'Theoretical Physicist', 'Albert Einstein'],
  ['gordon-ramsay', 'Gordon Ramsay', 'Chef & Restaurateur', 'Gordon Ramsay'],
  ['attenborough', 'David Attenborough', 'Natural Historian & Broadcaster', 'David Attenborough'],
  ['sundar-pichai', 'Sundar Pichai', 'Technology Executive', 'Sundar Pichai'],
  ['bill-gates', 'Bill Gates', 'Entrepreneur & Philanthropist', 'Bill Gates'],
  ['zohran-mamdani', 'Zohran Mamdani', 'Politician', 'Zohran Mamdani'],
  ['omar-suleiman', 'Omar Suleiman', 'Islamic Scholar & Imam', 'Omar Suleiman (imam)'],
  ['tim-cook', 'Tim Cook', 'Business Executive', 'Tim Cook'],
  ['salahuddin', 'Salahuddin al-Ayyubi', 'Sultan & Military Leader', 'Saladin'],
  ['al-khwarizmi', 'Al-Khwarizmi', 'Mathematician & Astronomer', 'Muhammad ibn Musa al-Khwarizmi'],
];

// [question, ids that answer YES]
const questions = [
  ['Is your person a woman?', ['jane-goodall', 'malala', 'marie-curie', 'greta']],
  ['Is your person alive today?', ['anthony-fauci', 'malala', 'greta', 'gordon-ramsay', 'attenborough', 'sundar-pichai', 'bill-gates', 'zohran-mamdani', 'omar-suleiman', 'tim-cook']],
  ['Was your person born before 1900?', ['marie-curie', 'einstein', 'salahuddin', 'al-khwarizmi']],
  ['Was your person born in the United States?', ['anthony-fauci', 'mlk', 'muhammad-ali', 'steve-jobs', 'bill-gates', 'omar-suleiman', 'tim-cook']],
  ['Was your person born in Europe?', ['jane-goodall', 'marie-curie', 'greta', 'einstein', 'gordon-ramsay', 'attenborough']],
  ['Has your person won a Nobel Prize?', ['malala', 'mlk', 'marie-curie', 'einstein']],
  ['Is your person known mainly for science, maths or medicine?', ['jane-goodall', 'anthony-fauci', 'marie-curie', 'einstein', 'al-khwarizmi']],
  ['Does your person work in technology?', ['steve-jobs', 'sundar-pichai', 'bill-gates', 'tim-cook']],
  ['Did your person found a company?', ['steve-jobs', 'bill-gates', 'gordon-ramsay']],
  ['Is your person best known as an activist?', ['malala', 'mlk', 'greta']],
  ['Is your person known for protecting nature or the environment?', ['jane-goodall', 'greta', 'attenborough']],
  ['Is your person Muslim?', ['malala', 'muhammad-ali', 'zohran-mamdani', 'omar-suleiman', 'salahuddin', 'al-khwarizmi']],
  ['Is your person a religious leader or scholar?', ['mlk', 'omar-suleiman']],
  ['Has your person led a government or held elected office?', ['zohran-mamdani', 'salahuddin']],
  ['Is your person famous for being on TV?', ['gordon-ramsay', 'attenborough']],
  ['Is your person an athlete?', ['muhammad-ali']],
];

(async () => {
  const out = {
    settings: {
      title: 'Guess Who?',
      edition: 'Career Edition',
      maxQuestions: 6,
      tagline: 'Your decision to make, your action to take.',
    },
    people: [],
    questions: questions.map(([text, yes], i) => ({ id: 'q' + (i + 1), text, yes })),
  };
  // Reuse photos already downloaded by a previous run so re-running only fills the gaps.
  const existing = fs.readdirSync(path.join(__dirname, 'uploads'));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const retry = async fn => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 5 || !/429/.test(e.message)) throw e; await sleep(10000 * (i + 1)); } } };
  for (const [id, name, position, wikiTitle] of people) {
    const have = existing.find(f => new RegExp('^' + id + '-[0-9a-f]{6}\\.').test(f));
    if (have) { out.people.push({ id, name, position, image: '/uploads/' + have, imageY: 20, source: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(wikiTitle.replace(/ /g, '_')) }); console.log('=', name); continue; }
    try {
      await sleep(2000);
      const info = await retry(() => wikiLookup(wikiTitle));
      const image = await retry(() => downloadImage(info.imageUrl, id));
      out.people.push({ id, name, position, image, imageY: 20, source: info.pageUrl });
      console.log('✓', name, '←', info.imageUrl);
    } catch (e) {
      console.log('✗', name, e.message);
      out.people.push({ id, name, position, image: '', imageY: 20, source: '' });
    }
  }
  fs.writeFileSync(path.join(__dirname, 'data', 'data.json'), JSON.stringify(out, null, 2));
  console.log('Wrote data/data.json');
})();
