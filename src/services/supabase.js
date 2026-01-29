import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config';

const hasConfig = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY;
const webStorage =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;
const storage = Platform.OS === 'web' ? webStorage : AsyncStorage;

const supabase = hasConfig
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export { supabase };
