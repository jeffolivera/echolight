const axios = require('axios');
require('dotenv').config();

const API = axios.create({
  baseURL: 'https://www.bungie.net/Platform',
  headers: {
    'X-API-Key': process.env.BUNGIE_API_KEY,
  },
});

let cachedManifest = {
    activityDefinitions: null,
    activityModeDefinitions: null,
};

async function loadManifestData() {
  if (cachedManifest.activityDefinitions && cachedManifest.activityModeDefinitions) {
    return cachedManifest;
  }
  try {
    // console.log('[Manifest] Buscando manifesto...');
    const manifestRes = await API.get('/Destiny2/Manifest/');
    const baseManifestUrl = 'https://www.bungie.net';
    const activityDefsPath = manifestRes.data.Response.jsonWorldComponentContentPaths.en?.DestinyActivityDefinition;
    const activityModeDefsPath = manifestRes.data.Response.jsonWorldComponentContentPaths.en?.DestinyActivityModeDefinition;

    if (!activityDefsPath || !activityModeDefsPath) {
      console.error("[Manifest] ERRO: Caminhos para definições não encontrados.");
      throw new Error('Caminhos do manifesto não encontrados (Activity ou ActivityMode).');
    }
    cachedManifest.activityDefinitions = (await axios.get(`${baseManifestUrl}${activityDefsPath}`)).data;
    cachedManifest.activityModeDefinitions = (await axios.get(`${baseManifestUrl}${activityModeDefsPath}`)).data;
    // console.log('[Manifest] Dados do manifesto carregados.');
    return cachedManifest;
  } catch (error) {
    console.error('[Manifest] ERRO ao carregar dados:', error.message);
    throw new Error(`Falha ao carregar dados do manifesto: ${error.message}`);
  }
}

async function getMembershipId(gamertag) {
  if (!process.env.BUNGIE_API_KEY) {
    console.error("[getMembershipId] ERRO CRÍTICO: Chave da API Bungie não configurada!");
    throw new Error("Configuração do servidor: Chave da API Bungie ausente.");
  }
  const parts = gamertag.split('#');
  if (parts.length !== 2) throw new Error('Gamertag inválida. Formato: Nome#1234.');
  const nameInput = parts[0];
  const codeStr = parts[1];
  const codeInput = parseInt(codeStr, 10);
  if (!nameInput || nameInput.trim() === "" || isNaN(codeInput)) throw new Error('Gamertag inválida. Nome ou código ausente/inválido.');

  try {
    const res = await axios.post(
      'https://www.bungie.net/Platform/User/Search/GlobalName/0/',
      { displayNamePrefix: nameInput },
      { headers: { 'X-API-Key': process.env.BUNGIE_API_KEY, 'Content-Type': 'application/json' } }
    );
    const searchResponse = res.data.Response;
    if (!searchResponse) {
        console.error("[getMembershipId] Resposta da API inesperada:", res.data);
        throw new Error("Erro API Bungie (formato de resposta inesperado).");
    }
    
    const results = searchResponse.searchResults || [];
    const nameInputLower = nameInput.toLowerCase();
    const filtered = results.filter(r => {
        const apiName = r.bungieGlobalDisplayName;
        const apiNameLower = apiName?.toLowerCase();
        const apiCode = r.bungieGlobalDisplayNameCode;
        const hasMemberships = r.destinyMemberships && r.destinyMemberships.length > 0;
        return apiNameLower === nameInputLower && apiCode === codeInput && hasMemberships;
    });

    if (filtered.length === 0) {
      if (results.length > 0) {
          // Este log é útil para depurar "Jogador não encontrado"
          console.log(`[getMembershipId Debug] Nenhum resultado para '${nameInput}#${codeInput}'. Resultados da API para prefixo '${nameInput}':`);
          results.slice(0,3).forEach(r => console.log(`  -> Nome API: ${r.bungieGlobalDisplayName}#${r.bungieGlobalDisplayNameCode}`));
      }
      throw new Error('Jogador não encontrado com nome/código fornecidos, ou sem conta Destiny ativa.');
    }
    const mappedPlayers = filtered.map(result => {
      const primaryMembership = result.destinyMemberships.find(m => m.crossSaveOverride !== 0 && m.membershipType === m.crossSaveOverride) || result.destinyMemberships[0];
      if (!primaryMembership || !primaryMembership.membershipId || typeof primaryMembership.membershipType === 'undefined') return null;
      return {
        membershipId: primaryMembership.membershipId,
        membershipType: primaryMembership.membershipType,
        displayName: `${result.bungieGlobalDisplayName}#${result.bungieGlobalDisplayNameCode}`,
      };
    }).filter(p => p !== null);

    if (mappedPlayers.length === 0 && filtered.length > 0) throw new Error("Jogador encontrado, mas sem dados de conta Destiny válidos.");
    return mappedPlayers;
  } catch (err) {
    console.error(`[getMembershipId] ERRO para "${gamertag}": ${err.message}`);
    if (err.response?.data?.Message) {
        console.error(`  Detalhe API Bungie (${err.response.data.ErrorCode}): ${err.response.data.Message}`);
    }
    throw err;
  }
}

async function getActivityHistory(membershipType, membershipId, characterId, modeFilter, count = 250) { 
    try {
        const res = await API.get(`/Destiny2/${membershipType}/Account/${membershipId}/Character/${characterId}/Stats/Activities/`, {
        params: { count, mode: modeFilter, page: 0 },
        });
        return res.data.Response?.activities || [];
    } catch (error) {
        console.error(`[ActivityHistory] Erro (char ${characterId}, mode ${modeFilter}):`, error.response?.data || error.message);
        return [];
    }
}

async function getCharacters(membershipType, membershipId) { 
    try {
        const res = await API.get(`/Destiny2/${membershipType}/Profile/${membershipId}/`, {
            params: { components: 'Characters' }
        });
        return Object.values(res.data.Response?.characters?.data || {});
    } catch (err) {
        console.error(`[Characters] Erro (mId ${membershipId}):`, err.response?.data || error.message);
        return [];
    }
}

// Removido modeFilterForContext dos parâmetros
async function groupActivitiesByExactNameAndMode(activities, activityDefinitions, activityModeDefinitions) {
  const activityStats = {}; 

  activities.forEach((activity) => {
    const completedValue = activity.values?.completed?.basic?.value;
    const completed = completedValue === 1;

    if (!completed) return;

    const referenceId = activity.activityDetails.referenceId; 
    const instanceModeHash = activity.activityDetails.mode;   

    const activityDef = activityDefinitions[referenceId];
    const modeDef = activityModeDefinitions[instanceModeHash];

    if (!activityDef || !activityDef.displayProperties || !activityDef.displayProperties.name) {
        return; 
    }
    
    const activityName = activityDef.displayProperties.name;
    let displayModeName = modeDef && modeDef.displayProperties && modeDef.displayProperties.name ? modeDef.displayProperties.name : ""; 
    
    let finalDisplayName;
    const modeNameLower = displayModeName.toLowerCase().trim();
    const activityNameTrimmed = activityName.trim();
    const cleanActivityName = activityNameTrimmed.replace(/:$/, '').trim();

    if (displayModeName && 
        modeNameLower !== "" &&
        !cleanActivityName.toLowerCase().includes(modeNameLower) && 
        modeNameLower !== "raid" && modeNameLower !== "dungeon" && 
        modeNameLower !== "normal" && modeNameLower !== "padrão" && modeNameLower !== "standard"
        ) {
        finalDisplayName = `${cleanActivityName}: ${displayModeName.trim()}`; 
    } else {
        finalDisplayName = cleanActivityName; 
    }
    
    finalDisplayName = finalDisplayName.replace(/\s\s+/g, ' ').trim();
    const groupKey = finalDisplayName; 

    if (!activityStats[groupKey]) {
      activityStats[groupKey] = {
        name: finalDisplayName, 
        icon: activityDef.displayProperties.hasIcon ? `https://www.bungie.net${activityDef.displayProperties.icon}` : null,
        count: 0, 
      };
    }
    
    if (typeof activityStats[groupKey].count !== 'number' || isNaN(activityStats[groupKey].count)) {
        console.error(`[GroupActivities ERROR] 'count' para '${groupKey}' não é um número ANTES do incremento! Valor: ${activityStats[groupKey].count}. Resetando para 0.`);
        activityStats[groupKey].count = 0; 
    }
    activityStats[groupKey].count += 1;
  });

  return Object.values(activityStats).filter(entry => entry.count > 0);
}

async function getAllActivitiesWithDetailedModes(gamertag, modeFilter) {
  const playerDataArray = await getMembershipId(gamertag); 

  if (!playerDataArray || playerDataArray.length === 0) {
    throw new Error('Jogador não encontrado (getAllActivitiesWithDetailedModes).');
  }

  const { activityDefinitions, activityModeDefinitions } = await loadManifestData();
  if (!activityDefinitions || !activityModeDefinitions) {
      throw new Error("Falha ao carregar manifesto.");
  }

  let allApiActivities = [];
  for (const player of playerDataArray) {
    if (!player?.membershipId || typeof player.membershipType === 'undefined') continue;
    const characters = await getCharacters(player.membershipType, player.membershipId);
    for (const character of characters) {
      if (!character?.characterId) continue;
      const activities = await getActivityHistory(player.membershipType, player.membershipId, character.characterId, modeFilter, 250);
      allApiActivities.push(...activities);
    }
  }

  if (allApiActivities.length === 0) return [];
  
  // Não passa mais modeFilter para a função de agrupamento
  const groupedActivities = await groupActivitiesByExactNameAndMode(allApiActivities, activityDefinitions, activityModeDefinitions);
  return groupedActivities;
}

module.exports = {
  getAllActivitiesWithDetailedModes,
};