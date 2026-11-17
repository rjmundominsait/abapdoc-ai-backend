const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(cors());

// Función para extraer dependencias y acotar el código si es gigantesco
function analyzeAndTrimAbapCode(code, maxLength = 4000) {
    const includes = new Set();
    const tables = new Set();
    const bapis = new Set();

    const includeRegex = /\bINCLUDE\s+([a-zA-Z0-9_/]+)/gi;
    let match;
    while ((match = includeRegex.exec(code)) !== null) {
        includes.add(match[1].toUpperCase());
    }

    const tableRegex = /\b(?:FROM|INTO|UPDATE|INTO TABLE|FROM TABLE|JOIN)\s+([a-zA-Z0-9_/]+)/gi;
    while ((match = tableRegex.exec(code)) !== null) {
        const tableName = match[1].toUpperCase();
        if (!['CORRESPONDING', 'TABLE', 'FIELDS', 'CLIENT', 'SPECIFIED', 'DBTABLE'].includes(tableName)) {
            tables.add(tableName);
        }
    }

    const bapiRegex = /\bCALL\s+FUNCTION\s+['"]([a-zA-Z0-9_/]+)['"]/gi;
    while ((match = bapiRegex.exec(code)) !== null) {
        bapis.add(match[1].toUpperCase());
    }

    // Si el código es muy largo, recortamos de forma inteligente para no superar los TPM de Groq
    let trimmedCode = code;
    if (code.length > maxLength) {
        trimmedCode = code.substring(0, maxLength) + "\n\n... [Código recortado automáticamente por exceso de tamaño para optimizar tokens] ...";
    }

    return {
        includes: Array.from(includes),
        tables: Array.from(tables),
        bapis: Array.from(bapis),
        trimmedCode
    };
}

app.post('/api/generate-docs', async (req, res) => {
    const { processDescription, objectsData } = req.body;

    if (!objectsData || objectsData.length === 0) {
        return res.status(400).json({ success: false, error: 'Faltan objetos para documentar.' });
    }

    try {
        let combinedCode = '';
        let globalDependencies = { includes: [], tables: [], bapis: [] };

        objectsData.forEach(obj => {
            const analysis = analyzeAndTrimAbapCode(obj.code);
            combinedCode += `=== OBJETO: ${obj.name} (${obj.type}) ===\n${analysis.trimmedCode}\n\n`;
            
            globalDependencies.includes.push(...analysis.includes);
            globalDependencies.tables.push(...analysis.tables);
            globalDependencies.bapis.push(...analysis.bapis);
        });

        globalDependencies.includes = [...new Set(globalDependencies.includes)];
        globalDependencies.tables = [...new Set(globalDependencies.tables)];
        globalDependencies.bapis = [...new Set(globalDependencies.bapis)];

        const prompt = `
            Eres un Arquitecto Técnico SAP S/4HANA experto. Analiza el proceso y las dependencias detectadas.

            Descripción: "${processDescription || 'Análisis técnico'}"
            Includes: ${globalDependencies.includes.join(', ') || 'Ninguno'}
            Tablas: ${globalDependencies.tables.join(', ') || 'Ninguna'}
            BAPIs: ${globalDependencies.bapis.join(', ') || 'Ninguna'}

            Código:
            ${combinedCode}

            Genera una Especificación Técnica en formato HTML limpio (sin bloques de código markdown como \`\`\`html) estructurada en:
            <h2>1. Resumen Ejecutivo</h2><p>...</p>
            <h2>2. Diagrama de Flujo del Proceso</h2><p>Esquema paso a paso detallado.</p>
            <h2>3. Arquitectura y Objetos</h2><table><tr><th>Componente</th><th>Tipo</th><th>Rol</th></tr></table>
            <h2>4. Lógica Detallada</h2><p>...</p>
            <h2>5. Tablas y Clean Core</h2><p>...</p>
        `;

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
