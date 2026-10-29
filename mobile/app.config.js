export default {
  expo: {
    name:'ToutAunClicLa Livraison',slug:'toutaunclicla-livraison',owner:'zenen',version:'0.2.1',orientation:'portrait',
    extra:{eas:{projectId:'1cafb686-44a9-458c-bdc1-12889e867664'}},
    icon:'./assets/app-icon.png',
    scheme:'toutaunclicla-livraison',userInterfaceStyle:'light',
    ios:{bundleIdentifier:'com.toutaunclicla.livraison',supportsTablet:true},
    android:{package:'com.toutaunclicla.livraison',googleServicesFile:'./google-services.json',permissions:['android.permission.RECEIVE_BOOT_COMPLETED','android.permission.POST_NOTIFICATIONS']},
    plugins:[['expo-notifications',{sounds:['./assets/assignment_jingle.wav'],defaultChannel:'deliveries-v1'}],'expo-secure-store','expo-dev-client',['expo-location',{
      locationWhenInUsePermission:'Votre position est partagée avec le centre de livraison pendant votre service. / Tu ubicación se comparte con el centro de entregas durante tu turno.',
      locationAlwaysAndWhenInUsePermission:'Pendant votre service, partagez votre position même avec l’écran verrouillé. Le partage s’arrête à la déconnexion. / Durante tu turno, comparte tu ubicación también con la pantalla bloqueada. Se detiene al desconectarte.',
      isIosBackgroundLocationEnabled:true,isAndroidBackgroundLocationEnabled:true,isAndroidForegroundServiceEnabled:true
    }]]
  }
};
