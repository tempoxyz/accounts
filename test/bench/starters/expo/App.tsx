import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'

export function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Acme</Text>
      <Text>Welcome to Acme.</Text>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: 'bold' },
})
