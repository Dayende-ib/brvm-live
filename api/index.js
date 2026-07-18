// api/index.js — Root endpoint pour Vercel Serverless Function
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'GET') {
    return res.status(200).json({
      message: 'BRVM Live API',
      version: '1.0.0',
      endpoints: {
        '/api/cours': {
          en: 'Get all stocks (JSON)',
          fr: 'Récupérer toutes les actions (JSON)'
        },
        '/api/cours?symbole=ONTBF': {
          en: 'Get single stock by symbol',
          fr: 'Récupérer une action par son symbole'
        },
        '/api/cours?format=csv': {
          en: 'Get all stocks in CSV format',
          fr: 'Récupérer toutes les actions (CSV)'
        }
      },
      security: {
        cors: {
          en: 'CORS enabled',
          fr: 'CORS activé'
        },
        headers: {
          en: 'Security headers enabled',
          fr: 'Headers de sécurité activés'
        },
        cache: {
          en: 'CDN cache enabled (30min)',
          fr: 'Cache CDN activé (30min)'
        }
      }
    });
  }
  
  return res.status(405).json({ erreur: 'Method not allowed' });
};
