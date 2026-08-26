import fs from 'fs';
let content = fs.readFileSync('src/App_v2.tsx', 'utf8');

const additionalStates = `  const [showTpnGames, setShowTpnGames] = useState(false);
  const [showLootbarGames, setShowLootbarGames] = useState(false);
  const [orderPage, setOrderPage] = useState(1);
`;

content = content.replace(
  'const [loadingSaved, setLoadingSaved] = useState(true);',
  'const [loadingSaved, setLoadingSaved] = useState(true);\n' + additionalStates
);

fs.writeFileSync('src/App_v2.tsx', content);
