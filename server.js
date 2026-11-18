document.addEventListener('DOMContentLoaded', () => {
    const btnGenerate = document.getElementById('btnGenerate');
    const sapUrlInput = document.getElementById('sapUrl');
    const processDescInput = document.getElementById('processDesc');
    const objectListInput = document.getElementById('objectList');

    chrome.storage.local.get(['lastSapUrl'], (result) => {
        if (result.lastSapUrl) {
            sapUrlInput.value = result.lastSapUrl;
        }
    });

    btnGenerate.addEventListener('click', async () => {
        const sapUrl = sapUrlInput.value.trim().replace(/\/$/, '');
        const processDescription = processDescInput.value.trim();
        const rawObjects = objectListInput.value.trim();

        if (!sapUrl || !rawObjects) {
            showOutput('❌ Rellena la URL de SAP y al menos un objeto.', 'error');
            return;
        }

        chrome.storage.local.set({ lastSapUrl: sapUrl });
        btnGenerate.disabled = true;
        btnGenerate.textContent = '⏳ Extrayendo y segmentando código...';

        const objectNames = rawObjects.split(',').map(o => o.trim().toUpperCase()).filter(o => o.length > 0);
        const allObjectsData = [];

        for (let i = 0; i < objectNames.length; i++) {
            const objName = objectNames[i];
            showOutput(`🔄 Analizando objeto ${i + 1} de ${objectNames.length}: <b>${objName}</b>...`, 'loading');
            
            const fetchedObjects = await fetchAbapObjectWithStructure(sapUrl, objName);
            if (!fetchedObjects || fetchedObjects.length === 0) {
                resetButton();
                return;
            }
            allObjectsData.push(...fetchedObjects);
        }

        showOutput(`✅ Componentes extraídos y optimizados.<br>🤖 Generando documentación con IA...`, 'loading');
        btnGenerate.textContent = '🤖 Analizando proceso...';

        const documentation = await callProcessBackend(processDescription, allObjectsData);
        const cleanHtml = documentation.replace(/```html/gi, '').replace(/```/g, '').trim();

        showOutput(`
            <div style="font-weight:600; color:#15803d;">🎉 Documentación del Proceso Generada</div>
            <div class="doc-card" id="docContent">${cleanHtml}</div>
            <div class="action-bar">
                <button class="btn-download" id="btnDownload">📥 Descargar Documento Word (.doc)</button>
                <button class="btn-copy" id="btnCopy">📋 Copiar</button>
            </div>
        `, 'success');

        document.getElementById('btnDownload').addEventListener('click', () => {
            exportProcessToWord(objectNames[0] || 'Proceso_SAP', processDescription, cleanHtml);
        });

        document.getElementById('btnCopy').addEventListener('click', () => {
            navigator.clipboard.writeText(document.getElementById('docContent').innerText);
            document.getElementById('btnCopy').textContent = '✅ Copiado';
            setTimeout(() => document.getElementById('btnCopy').textContent = '📋 Copiar', 2000);
        });

        resetButton();
    });

    function resetButton() {
        btnGenerate.disabled = false;
        btnGenerate.textContent = '✨ Documentar Proceso Completo';
    }
});

function showOutput(message, type) {
    const outputDiv = document.getElementById('output');
    outputDiv.style.display = 'block';
    
    if (type === 'error') {
        outputDiv.style.color = '#b91c1c';
        outputDiv.style.background = '#fef2f2';
        outputDiv.style.padding = '10px';
        outputDiv.style.borderRadius = '6px';
        outputDiv.style.border = '1px solid #fecaca';
    } else if (type === 'loading') {
        outputDiv.style.color = '#0369a1';
        outputDiv.style.background = '#f0f9ff';
        outputDiv.style.padding = '10px';
        outputDiv.style.borderRadius = '6px';
        outputDiv.style.border = '1px solid #bae6fd';
    } else {
        outputDiv.style.background = 'transparent';
        outputDiv.style.padding = '0';
        outputDiv.style.border = 'none';
    }
    outputDiv.innerHTML = message;
}

/**
 * Fragmentación optimizada: bloques de 15.000 caracteres para evitar miles de peticiones innecesarias
 */
function chunkCode(codeText, maxChunkLength = 15000) {
    if (!codeText || codeText.length <= maxChunkLength) {
        return [codeText];
    }
    
    const chunks = [];
    let index = 0;
    while (index < codeText.length) {
        chunks.push(codeText.substring(index, index + maxChunkLength));
        index += maxChunkLength;
    }
    return chunks;
}

async function fetchAbapObjectWithStructure(sapUrl, inputName) {
    let searchName = inputName.trim().toUpperCase();
    if (!searchName) return null;

    const cleanBaseUrl = sapUrl.replace(/\/+$/, '');
    let targetObjectName = searchName;
    let resolvedUri = null;
    let mainResultChunks = [];

    try {
        const searchUrl = `${cleanBaseUrl}/sap/bc/adt/repository/informationsystem/search?query=${encodeURIComponent(searchName)}&maxResults=5`;
        const searchResponse = await fetch(searchUrl, {
            method: 'GET',
            headers: { 
                'Accept': 'application/vnd.sap.adt.repository.inforepository.v1+xml, application/xml, text/plain', 
                'X-Requested-With': 'XMLHttpRequest' 
            },
            credentials: 'include',
            redirect: 'follow'
        });

        if (searchResponse.ok) {
            const xmlText = await searchResponse.text();
            const fullUriMatch = xmlText.match(new RegExp(`uri="(/sap/bc/adt/[^"]+)"`, 'i')) || 
                                 xmlText.match(new RegExp(`href="(/sap/bc/adt/[^"]+)"`, 'i'));
            
            if (fullUriMatch && fullUriMatch[1]) {
                resolvedUri = fullUriMatch[1];
            }

            const progMatch = xmlText.match(/adt\/programs\/programs\/([a-zA-Z0-9_\/]+)/i);
            const classMatch = xmlText.match(/adt\/oo\/classes\/([a-zA-Z0-9_\/]+)/i);

            if (progMatch && !resolvedUri) {
                targetObjectName = progMatch[1].toUpperCase();
                resolvedUri = `/sap/bc/adt/programs/programs/${targetObjectName}`;
            } else if (classMatch && !resolvedUri) {
                targetObjectName = classMatch[1].toUpperCase();
                resolvedUri = `/sap/bc/adt/oo/classes/${targetObjectName}`;
            }
        }
    } catch (err) {
        console.warn('Aviso en búsqueda nativa ADT:', err);
    }

    const possibleUrls = [];
    if (resolvedUri) possibleUrls.push(`${cleanBaseUrl}${resolvedUri}/source/main`);
    possibleUrls.push(
        `${cleanBaseUrl}/sap/bc/adt/programs/programs/${encodeURIComponent(searchName)}/source/main`,
        `${cleanBaseUrl}/sap/bc/adt/oo/classes/${encodeURIComponent(searchName)}/source/main`,
        `${cleanBaseUrl}/sap/bc/adt/programs/programs/${encodeURIComponent(targetObjectName)}/source/main`
    );

    const uniqueUrls = [...new Set(possibleUrls)];

    for (const targetUrl of uniqueUrls) {
        try {
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: { 'Accept': 'text/plain, application/vnd.sap.adt.abapsources.v1+plain, */*', 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'include',
                redirect: 'follow'
            });

            if (response.status === 401 || response.status === 403) {
                showOutput(`❌ <b>Sesión SAP expirada (${response.status}):</b> Inicia sesión en SAP en otra pestaña.`, 'error');
                return null;
            }

            const responseText = await response.text();
            if (responseText.includes('<!DOCTYPE html>') || responseText.includes('<html')) {
                showOutput(`❌ <b>Pantalla de Login detectada:</b> Tu sesión SAP requiere autenticación.`, 'error');
                return null;
            }

            if (response.ok && responseText.trim().length > 0) {
                const typeLabel = targetUrl.includes('classes') ? 'Clase Global (CLAS)' : 'Programa / Report Principal (PROG)';
                const codeChunks = chunkCode(responseText);

                mainResultChunks = codeChunks.map((chunk, idx) => ({
                    name: codeChunks.length > 1 ? `${targetObjectName} [Parte ${idx + 1}/${codeChunks.length}]` : targetObjectName,
                    resolvedName: targetObjectName,
                    type: `${typeLabel} (Bloque ${idx + 1} de ${codeChunks.length})`,
                    code: chunk
                }));
                break;
            }
        } catch (err) {
            console.warn(`Intento fallido en: ${targetUrl}`, err);
        }
    }

    if (mainResultChunks.length === 0) {
        showOutput(`⚠️ El objeto o transacción <b>${searchName}</b> no devolvió código fuente ejecutable en SAP ADT.`, 'error');
        return null;
    }

    const collectedObjects = [...mainResultChunks];

    // Auto-descubrimiento de includes funcionales
    try {
        const structureUrl = `${cleanBaseUrl}/sap/bc/adt/programs/programs/${encodeURIComponent(targetObjectName)}/objectstructure`;
        const structResponse = await fetch(structureUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/vnd.sap.adt.objectstructure.v2+xml, application/xml', 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'include',
            redirect: 'follow'
        });

        if (structResponse.ok) {
            const xmlText = await structResponse.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");
            
            const links = xmlDoc.querySelectorAll('link[rel*="definitionIdentifier"]');
            const subUris = new Set();

            links.forEach(link => {
                const href = link.getAttribute('href');
                if (href && href.includes('/source/main')) {
                    const lowerHref = href.toLowerCase();
                    const isTopInclude = lowerHref.includes('_top') || lowerHref.includes('_t01');
                    const isSelfMain = lowerHref.includes(`programs/programs/${targetObjectName.toLowerCase()}`);

                    if (!isTopInclude && !isSelfMain) {
                        subUris.add(href);
                    }
                }
            });

            for (const subUri of subUris) {
                const fullSubUrl = `${cleanBaseUrl}${subUri}`;
                try {
                    const subRes = await fetch(fullSubUrl, {
                        method: 'GET',
                        headers: { 'Accept': 'text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' },
                        credentials: 'include',
                        redirect: 'follow'
                    });

                    if (subRes.ok) {
                        const subCode = await subRes.text();
                        if (subCode.trim().length > 0) {
                            const nameMatch = subUri.match(/\/programs\/(?:includes|programs)\/([a-zA-Z0-9_]+)/i);
                            const subName = nameMatch ? nameMatch[1].toUpperCase() : 'INCLUDE_FUNCIONAL';

                            const subChunks = chunkCode(subCode);
                            subChunks.forEach((chunk, idx) => {
                                collectedObjects.push({
                                    name: subChunks.length > 1 ? `${subName} [Parte ${idx + 1}/${subChunks.length}]` : subName,
                                    type: `Include Funcional (Bloque ${idx + 1} de ${subChunks.length})`,
                                    code: chunk
                                });
                            });
                        }
                    }
                } catch (subErr) {
                    console.warn(`No se pudo descargar el include ${subUri}:`, subErr);
                }
            }
        }
    } catch (err) {
        console.warn('Aviso al procesar la estructura de ADT:', err);
    }

    return collectedObjects;
}

async function callProcessBackend(processDescription, objectsData) {
    try {
        const response = await fetch('https://abapdoc-ai-backend.onrender.com/api/generate-docs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ processDescription, objectsData })
        });

        if (!response.ok) {
            throw new Error(`Servidor IA: ${response.status}`);
        }

        const data = await response.json();
        if (data.success) {
            return data.documentation;
        } else {
            throw new Error(data.error || 'Error desconocido');
        }
    } catch (error) {
        return `<p style="color:#b91c1c;">❌ <b>Error al conectar con la IA:</b> ${error.message}</p>`;
    }
}

function exportProcessToWord(mainObject, description, htmlContent) {
    const header = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' 
              xmlns:w='urn:schemas-microsoft-com:office:word' 
              xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>Documentación de Proceso SAP</title>
        <style>
            body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1e293b; line-height: 1.5; }
            h1 { color: #0057d2; font-size: 18pt; border-bottom: 2px solid #0057d2; padding-bottom: 6px; margin-bottom: 20px; }
            h2 { color: #0070f2; font-size: 13pt; margin-top: 24px; border-left: 4px solid #0070f2; padding-left: 8px; }
            table { width: 100%; border-collapse: collapse; margin: 12px 0; }
            th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; font-size: 10pt; }
            th { background-color: #f1f5f9; color: #0f172a; font-weight: bold; }
            .box { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #0070f2; padding: 12px; margin-bottom: 20px; border-radius: 4px; }
            p { margin-bottom: 10px; }
            ul, ol { margin-top: 5px; margin-bottom: 10px; padding-left: 20px; }
            li { margin-bottom: 4px; }
        </style>
        </head><body>
        <h1>Especificación Técnica y Funcional de Proceso SAP</h1>
        <div class="box">
            <strong>Objeto Principal:</strong> ${mainObject}<br>
            <strong>Descripción del Proceso:</strong> ${description || 'Análisis técnico de componentes y estructura ADT'}<br>
            <strong>Fecha de Generación:</strong> ${new Date().toLocaleDateString()}
        </div>
    `;
    
    const footer = `
        <br><hr style="border: none; border-top: 1px solid #cbd5e1; margin-top: 30px;"/>
        <p style="font-size:9pt; color:#64748b; text-align: center;">
            Generado automáticamente con <strong>ABAP Process Documenter</strong> &bull; S/4HANA Architecture & Clean Core
        </p></body></html>
    `;

    const blob = new Blob(['\ufeff', header + htmlContent + footer], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Proceso_SAP_${mainObject}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
