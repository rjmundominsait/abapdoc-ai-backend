const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

const ai = new GoogleGenAI();

app.post('/api/generate-docs', async (req, res) => {
    const { processDescription, objectsData } = req.body;

    if (!processDescription && (!objectsData || objectsData.length === 0)) {
        return res.status(400).json({ error: 'Falta la descripción del proceso o los objetos.' });
    }

    try {
        const objectsSummary = objectsData.map(obj => 
            `--- OBJETO: ${obj.name} (${obj.type}) ---\n${obj.code}`
        ).join('\n\n');

        const prompt = `
            Eres un Arquitecto Técnico SAP S/4HANA experto. Redacta una Especificación Técnica y Funcional completa de un PROCESO END-TO-END en formato HTML limpio (sin etiquetas markdown como \`\`\`html).

            Contexto / Descripción del Proceso dada por el consultor:
            "${processDescription || 'No proporcionada, deducir del código.'}"

            Código fuente de los objetos involucrados en el proceso:
            ${objectsSummary}

            Estructura obligatoria del documento HTML:
            <h2>1. Resumen Ejecutivo y Objetivo del Proceso</h2>
            <p>Explicación clara de negocio y flujo general.</p>
            <h2>2. Arquitectura y Objetos Involucrados</h2>
            <table>
                <tr><th>Objeto</th><th>Tipo</th><th>Rol en el Proceso</th></tr>
                <!-- Rellenar con cada objeto analizado -->
            </table>
            <h2>3. Flujo Detallado Paso a Paso</h2>
            <p>Cómo interactúan los Reports, Clases, Vistas CDS y tablas entre sí.</p>
            <h2>4. Tablas Estándar / Z y Puntos Críticos (Clean Core)</h2>
            <p>Tablas principales leídas/actualizadas y recomendaciones técnicas.</p>
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        res.json({ success: true, documentation: response.text });

    } catch (error) {
        console.error('Error con la IA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend de IA corriendo en puerto ${PORT}`);
});
