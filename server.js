const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(cors());

app.post('/api/generate-docs', async (req, res) => {
    const { processDescription, objectsData } = req.body;

    if (!objectsData || objectsData.length === 0) {
        return res.status(400).json({ success: false, error: 'Faltan objetos para documentar.' });
    }

    try {
        const codeCombined = objectsData.map(obj => 
            `=== OBJETO: ${obj.name} (${obj.type}) ===\n${obj.code}`
        ).join('\n\n');

        const prompt = `
            Eres un Arquitecto Técnico SAP S/4HANA experto. Analiza el siguiente proceso y los códigos fuente asociados, y redacta una Especificación Técnica y Funcional completa en formato HTML limpio (sin bloques de código markdown como \`\`\`html).

            Descripción del Proceso:
            "${processDescription || 'Análisis técnico de integración de componentes ABAP'}"

            Códigos fuente:
            ${codeCombined}

            Estructura obligatoria:
            <h2>1. Resumen Ejecutivo y Objetivo del Proceso</h2>
            <p>Explicación clara de negocio y flujo general.</p>
            <h2>2. Arquitectura y Objetos Involucrados</h2>
            <table>
                <tr><th>Objeto</th><th>Tipo</th><th>Rol en el Proceso</th></tr>
            </table>
            <h2>3. Flujo Detallado Paso a Paso</h2>
            <p>Cómo interactúan los Reports, Clases, Vistas CDS y tablas entre sí.</p>
            <h2>4. Tablas Estándar / Z y Puntos Críticos (Clean Core)</h2>
            <p>Tablas principales leídas/actualizadas y recomendaciones técnicas.</p>
        `;

        // Llamada actualizada al modelo operativo actual de Groq
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-20b',
                messages: [
                    { role: 'system', content: 'Eres un Arquitecto SAP experto que responde únicamente en HTML limpio.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.2
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            throw new Error(`Error Groq (${response.status}): ${errData}`);
        }

        const data = await response.json();
        const textResult = data.choices?.[0]?.message?.content || 'No se pudo generar contenido.';

        res.json({ success: true, documentation: textResult });

    } catch (error) {
        console.error('Error detallado en backend:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend corriendo en puerto ${PORT}`);
});
