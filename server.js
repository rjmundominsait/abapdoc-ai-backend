const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(cors());

// Motor de extracción estática de dependencias ABAP
function analyzeAbapDependencies(code) {
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

    let trimmedCode = code;
    if (code.length > 5000) {
        trimmedCode = code.substring(0, 5000) + "\n\n... [Código optimizado para análisis de IA] ...";
    }

    return {
        includes: Array.from(includes),
        tables: Array.from(tables),
        bapis: Array.from(bapis),
        trimmedCode
    };
}

// Endpoint 1: Generación de documentación con IA (Groq)
app.post('/api/generate-docs', async (req, res) => {
    const { processDescription, objectsData } = req.body;

    if (!objectsData || objectsData.length === 0) {
        return res.status(400).json({ success: false, error: 'Faltan objetos para documentar.' });
    }

    try {
        let combinedCode = '';
        let globalDependencies = { includes: [], tables: [], bapis: [] };

        objectsData.forEach(obj => {
            const analysis = analyzeAbapDependencies(obj.code);
            combinedCode += `=== OBJETO: ${obj.name} (${obj.type}) ===\n${analysis.trimmedCode}\n\n`;
            
            globalDependencies.includes.push(...analysis.includes);
            globalDependencies.tables.push(...analysis.tables);
            globalDependencies.bapis.push(...analysis.bapis);
        });

        globalDependencies.includes = [...new Set(globalDependencies.includes)];
        globalDependencies.tables = [...new Set(globalDependencies.tables)];
        globalDependencies.bapis = [...new Set(globalDependencies.bapis)];

        // Prompt de Agente Experto SAP con capacidad investigadora
        const prompt = `
            Actúa como un Arquitecto Técnico SAP S/4HANA Senior e investigador de código fuente ABAP.
            Tu misión es analizar el código proporcionado, deducir la investigación end-to-end del proceso, 
            relacionar los includes detectados y estructurar un flujograma técnico impecable.

            - Contexto del Usuario: "${processDescription || 'Análisis técnico general'}"
            - Includes descubiertos automáticamente: ${globalDependencies.includes.join(', ') || 'Ninguno'}
            - Tablas / Vistas accedidas: ${globalDependencies.tables.join(', ') || 'Ninguna'}
            - BAPIs / Funciones invocadas: ${globalDependencies.bapis.join(', ') || 'Ninguna'}

            Código Fuente Analizado:
            ${combinedCode}

            Genera una Especificación Técnica y Funcional completa en formato HTML limpio (sin bloques de código markdown como \`\`\`html), estructurada exactamente así:

            <h2>1. Resumen Ejecutivo y Objetivo</h2>
            <p>Propósito técnico y de negocio del desarrollo analizado.</p>

            <h2>2. Diagrama de Flujo del Proceso (Flujograma Secuencial)</h2>
            <p>Esquema paso a paso detallado (Paso 1: Entrada/Transacción ➔ Paso 2: Validación ➔ Paso 3: Ejecución en Includes/Clases ➔ Paso 4: Base de Datos ➔ Paso 5: Salida).</p>

            <h2>3. Arquitectura y Relación de Objetos</h2>
            <table>
                <tr><th>Componente / Include</th><th>Tipo</th><th>Rol e Interacción en el Proceso</th></tr>
            </table>

            <h2>4. Lógica Detallada y Puntos Críticos</h2>
            <p>Explicación técnica de cómo interactúan los includes, validaciones y tratamiento de errores.</p>

            <h2>5. Tablas Afectadas y Consideraciones Clean Core</h2>
            <p>Tablas involucradas y recomendaciones de rendimiento S/4HANA.</p>
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
                    { role: 'system', content: 'Eres un Arquitecto SAP experto que investiga código y responde únicamente en HTML limpio.' },
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

// Endpoint 2: Proxy seguro para descargar el código fuente desde SAP ADT sin CORS
app.post('/api/fetch-sap-code', async (req, res) => {
    const { sapUrl, objectName } = req.body;

    if (!sapUrl || !objectName) {
        return res.status(400).json({ success: false, error: 'Faltan parámetros de URL o nombre de objeto.' });
    }

    try {
        const cleanBaseUrl = sapUrl.replace(/\/+$/, '');
        const targetUrl = `${cleanBaseUrl}/sap/bc/adt/programs/programs/${encodeURIComponent(objectName)}/source/main`;

        console.log(`🔍 [Backend Proxy] Consultando SAP ADT: ${targetUrl}`);

        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'Accept': 'text/plain, application/vnd.sap.adt.abapsources.v1+plain, */*',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ 
                success: false, 
                error: `SAP devolvió el estado HTTP ${response.status}. Comprueba que el programa '${objectName}' exista.` 
            });
        }

        const codeText = await response.text();
        
        if (codeText.includes('<!DOCTYPE html>') || codeText.includes('<html')) {
            return res.status(401).json({ success: false, error: 'La respuesta de SAP fue una página de login. Verifica la sesión.' });
        }

        res.json({ success: true, code: codeText });

    } catch (error) {
        console.error('Error en proxy SAP (Render):', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend corriendo en puerto ${PORT}`);
});
