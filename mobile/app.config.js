export default {
  expo: {
    name:'ToutAunClicLa Livraison',slug:'toutaunclicla-livraison',version:'0.1.0',orientation:'portrait',
    scheme:'toutaunclicla-livraison',userInterfaceStyle:'light',
    ios:{bundleIdentifier:'com.toutaunclicla.livraison',supportsTablet:true},
    android:{package:'com.toutaunclicla.livraison'},
    plugins:['expo-secure-store','expo-dev-client',['expo-location',{
      locationWhenInUsePermission:'Votre position est partagée avec le centre de livraison pendant votre service. / Tu ubicación se comparte con el centro de entregas durante tu turno.',
      locationAlwaysAndWhenInUsePermission:'Pendant votre service, partagez votre position même avec l’écran verrouillé. Le partage s’arrête à la déconnexion. / Durante tu turno, comparte tu ubicación también con la pantalla bloqueada. Se detiene al desconectarte.',
      isIosBackgroundLocationEnabled:true,isAndroidBackgroundLocationEnabled:true,isAndroidForegroundServiceEnabled:true
    }]]
  }
};
