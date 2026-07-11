import fs from 'fs';
import path from 'path';
import { DATABASE_DIR } from './paths.js';

const WELCOME_IMAGES_DIR = path.join(DATABASE_DIR, 'welcome_images');

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

export async function saveWelcomeImage(groupId, imageBuffer) {
    try {
        if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
            throw new Error('Buffer de imagem inválido');
        }

        ensureDirectoryExists(WELCOME_IMAGES_DIR);

        const fileName = `${groupId.replace(/[^a-zA-Z0-9@._-]/g, '_')}.jpg`;
        const filePath = path.join(WELCOME_IMAGES_DIR, fileName);

        fs.writeFileSync(filePath, imageBuffer);

        const relativePath = `welcome_images/${fileName}`;

        return { success: true, path: relativePath, fullPath: filePath };
    } catch (error) {
        console.error('[WelcomeImages] Erro ao salvar imagem:', error.message);
        return { success: false, error: error.message };
    }
}

export async function loadWelcomeImage(imagePath) {
    try {
        if (!imagePath || typeof imagePath !== 'string') {
            return { success: false, error: 'Caminho da imagem inválido' };
        }

        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
            return { success: false, isUrl: true, url: imagePath };
        }

        const fullPath = path.join(DATABASE_DIR, imagePath);

        if (!fs.existsSync(fullPath)) {
            return { success: false, error: 'Arquivo não encontrado' };
        }

        const buffer = fs.readFileSync(fullPath);
        return { success: true, buffer };
    } catch (error) {
        console.error('[WelcomeImages] Erro ao carregar imagem:', error.message);
        return { success: false, error: error.message };
    }
}

export async function deleteWelcomeImage(imagePath) {
    try {
        if (!imagePath || typeof imagePath !== 'string') {
            return { success: false };
        }

        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
            return { success: true };
        }

        const fullPath = path.join(DATABASE_DIR, imagePath);

        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }

        return { success: true };
    } catch (error) {
        console.error('[WelcomeImages] Erro ao deletar imagem:', error.message);
        return { success: false, error: error.message };
    }
}

export function isLocalImagePath(imagePath) {
    if (!imagePath || typeof imagePath !== 'string') {
        return false;
    }
    return !imagePath.startsWith('http://') && !imagePath.startsWith('https://');
}

export function getImagePath(groupId) {
    return path.join(WELCOME_IMAGES_DIR, `${groupId.replace(/[^a-zA-Z0-9@._-]/g, '_')}`);
}

export default {
    saveWelcomeImage,
    loadWelcomeImage,
    deleteWelcomeImage,
    isLocalImagePath,
    getImagePath
};
