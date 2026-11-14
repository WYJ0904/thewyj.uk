package uk.thewyj.app.finance

import org.junit.Assert.*
import org.junit.Test
import uk.thewyj.app.task21.HttpNotificationIngestTransport
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class CurrencyTransportTest {
    @Test fun actualIngestTransportAdvertisesReviewCapabilityAndKeepsQueuedBodyExact() {
        val server=ServerSocket(0,1,InetAddress.getByName("127.0.0.1"));server.soTimeout=3000
        val executor=Executors.newSingleThreadExecutor()
        val original="{\"schema_version\":1,\"operations\":[],\"synthetic\":true}"
        val accepted=executor.submit<List<Pair<Map<String,String>,String>>> {
            (1..2).map {
                server.accept().use { socket ->
                    socket.soTimeout=3000
                    val reader=socket.getInputStream().bufferedReader(Charsets.UTF_8)
                    assertTrue(reader.readLine().startsWith(if(it==1) "GET " else "POST "))
                    val headers=mutableMapOf<String,String>()
                    while(true){val line=reader.readLine() ?: error("Incomplete synthetic HTTP request");if(line.isEmpty())break;headers[line.substringBefore(':').lowercase()]=line.substringAfter(':').trim()}
                    val body=CharArray(headers["content-length"]?.toInt()?:0);var offset=0
                    while(offset<body.size){val count=reader.read(body,offset,body.size-offset);check(count>0);offset+=count}
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".toByteArray())
                    Pair(headers,String(body))
                }
            }
        }
        try {
            val transport=HttpNotificationIngestTransport("http://127.0.0.1:${server.localPort}")
            assertTrue(transport.get("/api/finance/transactions?money_version=2","synthetic-session").ok)
            assertTrue(transport.post("/api/notification/ingest","synthetic-session",original).ok)
            val rows=accepted.get(5,TimeUnit.SECONDS)
            for(row in rows)assertEquals("3",row.first["x-finance-money-version"])
            assertEquals(original,rows.last().second)
        } finally {server.close();executor.shutdownNow()}
    }
}
