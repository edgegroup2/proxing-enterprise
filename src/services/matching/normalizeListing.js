'use strict';

function inferCategory(text = '') {
  const value = String(text).toLowerCase();

  if (/(ride|car|driver|trip|going to|transport)/.test(value)) {
    return { category: 'transport', subcategory: 'ride' };
  }

  if (/(plumber|electrician|painter|artisan|welder|carpenter)/.test(value)) {
    return { category: 'artisans', subcategory: 'artisan_service' };
  }

  if (/(usd|dollar|gbp|pounds|eur|euro|fx|foreign exchange)/.test(value)) {
    return { category: 'fx', subcategory: 'peer_to_peer_fx' };
  }

  if (/(flat|apartment|property|rent|house|shop|office|land)/.test(value)) {
    return { category: 'property', subcategory: 'real_estate' };
  }

  if (/(delivery|dispatch|send package|courier)/.test(value)) {
    return { category: 'delivery', subcategory: 'courier' };
  }

  return { category: 'marketplace_goods', subcategory: 'general' };
}

function inferMode(text = '') {
  const value = String(text).toLowerCase();

  if (/(i need|looking for|want to buy|need|seeking|find me|i want)/.test(value)) {
    return 'seeking';
  }

  if (/(i sell|i have|offering|available|for sale|i offer)/.test(value)) {
    return 'offering';
  }

  return 'seeking';
}

function extractTags(text = '') {
  return Array.from(
    new Set(
      String(text)
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .filter((x) => x.length >= 3)
        .slice(0, 20)
    )
  );
}

async function normalizeListing(input = {}) {
  const rawText = String(input.rawText || input.title || input.description || '').trim();
  const inferred = inferCategory(rawText);
  const mode = input.mode || inferMode(rawText);
  const tags = extractTags(rawText);

  return {
    mode,
    category: input.category || inferred.category,
    subcategory: input.subcategory || inferred.subcategory,
    title: input.title || rawText.slice(0, 120) || 'Untitled Listing',
    description: input.description || rawText || null,
    aiSummary: rawText || null,
    aiTags: tags,
    aiStructured: {
      rawText,
      inferredMode: mode,
      inferredCategory: inferred.category,
      inferredSubcategory: inferred.subcategory
    }
  };
}

module.exports = {
  normalizeListing
};
