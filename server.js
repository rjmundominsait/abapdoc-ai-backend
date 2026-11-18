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

// Endpoint: Resolución inteligente de Transacciones (TCode) mediante IA
app.post('/api/resolve-tcode', async (req, res) => {
    const { inputName } = req.body;
    let cleanInput = (inputName || '').trim().toUpperCase();

    if (!cleanInput) {
        return res.status(400).json({ success: false, error: 'Falta el nombre de objeto o transacción.' });
    }

    try {
        console.log(`🧠 [IA Resolver] Analizando transacción o identificador: ${cleanInput}`);
        
        const prompt = `
            Eres un experto Arquitecto SAP ABAP. Un consultor ha introducido este identificador en la herramienta: "${cleanInput}".
            En los sistemas SAP S/4HANA, las transacciones apuntan a un programa ejecutable o clase global.
            Devuelve ÚNICAMENTE el nombre técnico del programa ejecutable o clase ABAP que le corresponde lógicamente según las convenciones estándar de SAP, sin texto adicional, sin explicaciones y sin bloques markdown, solo el nombre exacto en mayúsculas.
        `;

        const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-20b',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1
            })
        });

        if (!aiResponse.ok) {
            return res.json({ success: true, resolvedName: cleanInput });
        }

        const aiData = await aiResponse.json();
        let guessedName = aiData.choices?.[0]?.message?.content?.trim().toUpperCase();
        guessedName = guessedName ? guessedName.replace(/[^A-Z0-9_/]/g, '') : cleanInput;

        console.log(`🤖 [IA Resolver] Transacción '${cleanInput}' traducida al programa técnico: '${guessedName}'`);
        res.json({ success: true, resolvedName: guessedName || cleanInput });

    } catch (error) {
        console.error('Error resolviendo TCode con IA:', error);
        res.json({ success: true, resolvedName: cleanInput });
    }
});

// Endpoint: Generación de documentación por bloques con control de Rate Limit (429) y reintentos automáticos
app.post('/api/generate-docs', async (req, res) => {
    const { processDescription, objectsData } = req.body;

    if (!objectsData || objectsData.length === 0) {
        return res.status(400).json({ success: false, error: 'Faltan objetos para documentar.' });
    }

    // Función auxiliar para realizar peticiones a Groq con reintento automático si salta el límite 429
    async function callGroqWithRetry(payload, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                return await response.json();
            }

            const errBody = await response.text();
            
            // Si es error 429 (Rate Limit), extraemos el tiempo de espera sugerido o esperamos por defecto
            if (response.status === 429 && attempt < maxRetries) {
                let waitTimeMs = 15000; // 15 segundos por defecto
                try {
                    const parsedErr = JSON.parse(errBody);
                    const match = parsedErr.error?.message?.match(/try again in ([0-9.]+)s/);
                    if (match && match[1]) {
                        waitTimeMs = Math.ceil(parseFloat(match[1]) * 1000) + 1000; // +1s de margen
                    }
                } catch (e) {}

                console.warn(`⚠️ Rate Limit (429) alcanzado en Groq. Reintentando en ${waitTimeMs / 1000}s (Intento ${attempt}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, waitTimeMs));
                continue;
            }

            throw new Error(`Error Groq (${response.status}): ${errBody}`);
        }
        throw new Error('Se superó el límite de reintentos por saturación de tokens en Groq.');
    }

    try {
        let globalDependencies = { includes: [], tables: [], bapis: [] };
        let partialAnalyses = [];

        console.log(`📦 Procesando ${objectsData.length} bloques/componentes de forma secuencial segura...`);

        // FASE MAP: Analizamos cada bloque con pausa preventiva entre peticiones
        for (let i = 0; i < objectsData.length; i++) {
            const obj = objectsData[i];
            const analysis = analyzeAbapDependencies(obj.code);
            
            globalDependencies.includes.push(...analysis.includes);
            globalDependencies.tables.push(...analysis.tables);
            globalDependencies.bapis.push(...analysis.bapis);

            const mapPrompt = `
                Analiza este fragmento de código ABAP (${obj.name} - ${obj.type}) para el proceso: "${processDescription || 'General'}".
                Extrae los puntos clave de negocio, llamadas a BAPIs, tablas y flujo lógico de este bloque específico.
                
                Código Fuente:
                ${analysis.trimmedCode}
            `;

            const mapData = await callGroqWithRetry({
                model: 'openai/gpt-oss-20b',
                messages: [
                    { role: 'system', content: 'Eres un analista SAP experto. Extrae notas técnicas concisas de este fragmento.' },
                    { role: 'user', content: mapPrompt }
                ],
                temperature: 0.1
            });

            const summary = mapData.choices?.[0]?.message?.content || '';
            partialAnalyses.push(`--- ANÁLISIS DE ${obj.name} (${obj.type}) ---\n${summary}`);

            // PAUSA PREVENTIVA: Esperamos 4 segundos obligatorios entre bloque y bloque para no saturar los 8k TPM
            if (i < objectsData.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 4000));
            }
        }

        globalDependencies.includes = [...new Set(globalDependencies.includes)];
        globalDependencies.tables = [...new Set(globalDependencies.tables)];
        globalDependencies.bapis = [...new Set(globalDependencies.bapis)];

        // FASE REDUCE: Consolidación final del documento HTML
        const reducePrompt = `
            Actúa como un Arquitecto Técnico SAP S/4HANA Senior.
            Con base en los análisis parciales de los bloques de código y las dependencias detectadas, genera una Especificación Técnica y Funcional completa en formato HTML limpio (sin bloques de código markdown como \`\`\`html).

            - Contexto del Usuario: "${processDescription || 'Análisis técnico general'}"
            - Includes descubiertos: ${globalDependencies.includes.join(', ') || 'Ninguno'}
            - Tablas accedidas: ${globalDependencies.tables.join(', ') || 'Ninguna'}
            - BAPIs invocadas: ${globalDependencies.bapis.join(', ') || 'Ninguna'}

            Resumen de análisis por bloques:
            ${partialAnalyses.join('\n\n')}

            Estructura exacta requerida en HTML:
            <h2>1. Resumen Ejecutivo y Objetivo</h2>
            <p>Propósito técnico y de negocio del desarrollo analizado.</p>

            <h2>2. Diagrama de Flujo del Proceso (Flujograma Secuencial)</h2>
            <p>Incluye obligatoriamente un esquema visual de flujo secuencial utilizando una tabla HTML estilizada con celdas y flechas (➔), estructurada de izquierda a derecha o en bloques claros para representar el proceso end-to-end.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 15px 0; background-color: #f8fafc;">
                <tr>
                    <td style="width: 30%; text-align: center; border: 1px solid #cbd5e1; padding: 10px; background: #ffffff;"><strong>1. Entrada</strong><br/><span style="font-size: 9pt; color: #64748b;">Objeto / TCode</span></td>
                    <td style="width: 5%; text-align: center; border: none; font-size: 14pt; color: #0070f2;">➔</td>
                    <td style="width: 30%; text-align: center; border: 1px solid #cbd5e1; padding: 10px; background: #ffffff;"><strong>2. Procesamiento</strong><br/><span style="font-size: 9pt; color: #64748b;">Includes / Lógica</span></td>
                    <td style="width: 5%; text-align: center; border: none; font-size: 14pt; color: #0070f2;">➔</td>
                    <td style="width: 30%; text-align: center; border: 1px solid #cbd5e1; padding: 10px; background: #ffffff;"><strong>3. Persistencia</strong><br/><span style="font-size: 9pt; color: #64748b;">Tablas / BAPIs</span></td>
                </tr>
            </table>
            <p>Añade debajo una breve descripción paso a paso de los hitos observados.</p>

            <h2>3. Arquitectura y Relación de Objetos</h2>
            <table>
                <tr><th>Componente / Include</th><th>Tipo</th><th>Rol e Interacción en el Proceso</th></tr>
            </table>

            <h2>4. Lógica Detallada y Puntos Críticos</h2>
            <p>Explicación técnica de cómo interactúan los includes, validaciones y tratamiento de errores.</p>

            <h2>5. Tablas Afectadas y Consideraciones Clean Core</h2>
            <p>Tablas involucradas y recomendaciones de rendimiento S/4HANA.</p>
        `;

        const reduceData = await callGroqWithRetry({
            model: 'openai/gpt-oss-20b',
            messages: [
                { role: 'system', content: 'Eres un Arquitecto SAP experto que genera especificaciones técnicas en HTML limpio.' },
                { role: 'user', content: reducePrompt }
            ],
            temperature: 0.2
        });

        const textResult = reduceData.choices?.[0]?.message?.content || 'No se pudo generar contenido.';
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
